'use strict';
'require view';
'require rpc';
'require poll';
'require ui';

const status = rpc.declare({ object: 'luci.wifilab', method: 'status', reject: true });
const start = rpc.declare({
	object: 'luci.wifilab', method: 'start', reject: true,
	params: ['iface', 'mode', 'band', 'seconds', 'channel', 'bssid', 'station', 'count']
});
const stop = rpc.declare({ object: 'luci.wifilab', method: 'stop', params: ['job'], reject: true });
const clear = rpc.declare({ object: 'luci.wifilab', method: 'clear', reject: true });
const clearCaps = rpc.declare({ object: 'luci.wifilab', method: 'clear_caps', reject: true });
const download = rpc.declare({ object: 'luci.wifilab', method: 'download', params: ['job', 'chunk'], reject: true });
const requestDeauth = rpc.declare({ object: 'luci.wifilab', method: 'deauth', params: ['job', 'bssid', 'station', 'count'], reject: true });
const isMac = value => /^([a-f\d]{2}:){5}[a-f\d]{2}$/i.test(value);
const styles = `
	.wfl { display:grid; gap:1rem; }
	.wfl h2, .wfl h3, .wfl p { margin:0; }
	.wfl h3 { font-size:1.15rem; }
	.wfl .wfl-card { border:1px solid color-mix(in srgb,currentColor 19%,transparent); border-radius:10px; padding:1rem; min-width:0; display:grid; gap:.7rem; }
	.wfl .wfl-head, .wfl .wfl-actions, .wfl .wfl-summary { display:flex; flex-wrap:wrap; align-items:center; gap:.55rem; }
	.wfl .wfl-head { justify-content:space-between; }
	.wfl .wfl-sub { opacity:.75; }
	.wfl .wfl-chip { border:1px solid color-mix(in srgb,currentColor 24%,transparent); border-radius:999px; padding:.2rem .65rem; font-size:.87rem; font-weight:600; }
	.wfl .wfl-chip[data-tone="running"] { background:#dbeafe; color:#1e40af; }
	.wfl .wfl-chip[data-tone="success"] { background:#dcfce7; color:#166534; }
	.wfl .wfl-chip[data-tone="warning"] { background:#fef3c7; color:#854d0e; }
	.wfl .wfl-selected { background:color-mix(in srgb,#3b82f6 16%,transparent); }
	.wfl .wfl-name { text-align:left; font-weight:600; max-width:22rem; white-space:normal; overflow-wrap:anywhere; }
	.wfl .wfl-card summary { cursor:pointer; font-weight:600; }
	.wfl .wfl-card pre { margin:.5rem 0 0; }
	.wfl .wfl-card .td, .wfl .wfl-card .th { padding:.5rem .65rem; }
	.wfl .wfl-card input[type=search] { min-width:12rem; }
	.wfl .wfl-stats { display:flex; flex-wrap:wrap; gap:.45rem .75rem; }
	.wfl .wfl-filters { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:.65rem 1rem; align-items:end; }
	.wfl .wfl-filter { display:grid; gap:.3rem; min-width:0; }
	.wfl .wfl-filter > span { font-weight:600; }
	.wfl .wfl-filter input[type=search], .wfl .wfl-filter select { width:100%; min-width:0; box-sizing:border-box; }
	.wfl .wfl-filter-check { display:flex; align-items:center; gap:.45rem; padding:.45rem 0; }
	.wfl .wfl-sort { background:transparent; color:inherit; border:0; font:inherit; cursor:pointer; white-space:nowrap; padding:0; }
	.wfl .wfl-sort span { margin-left:.3em; }
	@media (max-width:700px) { .wfl .wfl-filters { grid-template-columns:1fr; } }
	.wfl .wfl-monitor { display:inline-block; border:1px solid currentColor; border-radius:5px; padding:.25rem .6rem; background:transparent; font-weight:600; }
	.wfl .wfl-monitor[data-tone="success"] { color:#16a34a; }
	.wfl .wfl-device .table { width:100%; table-layout:fixed; }
	.wfl .wfl-device .tr > :first-child { width:38%; font-weight:600; }
	.wfl .wfl-device .td { overflow-wrap:anywhere; }
`;

function csvRows(raw) {
	const networks = new Map();
	const clients = [];
	let stations = false;
	for (const line of raw.split(/\r?\n/)) {
		if (line.startsWith('Station MAC')) {
			stations = true;
			continue;
		}
		const fields = line.split(',').map(value => value.trim());
		const mac = fields[0].toLowerCase();
		if (!isMac(mac))
			continue;
		if (stations && isMac(fields[5] || '')) {
			clients.push({ mac, bssid: fields[5].toLowerCase(), signal: fields[3], packets: fields[4], last: fields[2] });
		}
		else if (!stations && fields.length >= 14) {
			networks.set(mac, {
				mac, channel: fields[3], signal: fields[8], security: fields.slice(5, 8).join(' '),
				ssid: fields.slice(13, -1).join(', '), clients: []
			});
		}
	}
	for (const client of clients) {
		if (!networks.has(client.bssid))
			networks.set(client.bssid, { mac: client.bssid, clients: [] });
		networks.get(client.bssid).clients.push(client);
	}
	return [...networks.values()];
}

function scanDetails(raw) {
	const networks = new Map();
	for (const block of raw.split(/^BSS /m).slice(1)) {
		const mac = block.slice(0, 17).toLowerCase();
		if (isMac(mac))
			networks.set(mac, { wps: /^\s+WPS:/m.test(block), raw: block });
	}
	return networks;
}

function wirelessInterfaces(raw) {
	const interfaces = new Map();
	for (const radio of raw.split(/(?=^phy#\d+)/m)) {
		const phy = radio.match(/^phy#(\d+)/);
		for (const block of radio.split(/\n(?=\s*Interface )/)) {
			const name = block.match(/^\s*Interface (\S+)/);
			const type = block.match(/^\s*type (.+)$/m);
			if (phy && name && type)
				interfaces.set(name[1], { phy: 'phy' + phy[1], type: type[1].trim(), raw: block.trim() });
		}
	}
	return interfaces;
}

function table(headers, rows, selectedIndex = -1) {
	return E('div', { style: 'overflow-x:auto' }, E('table', { class: 'table' }, [
		E('tr', { class: 'tr table-titles' }, headers.map(label => E('th', { class: 'th', scope: 'col' }, label))),
		...rows.map((row, index) => E('tr', { class: 'tr' + (index === selectedIndex ? ' wfl-selected' : '') },
			row.map(value => E('td', { class: 'td' }, value))))
	]));
}

function signal(value) {
	const dbm = Number(value);
	if (!value || !Number.isFinite(dbm) || dbm >= -1)
		return '—';
	const level = dbm >= -55 ? 4 : dbm >= -67 ? 3 : dbm >= -80 ? 2 : 1;
	const colors = ['#800020', '#dc2626', '#d8a300', '#16a34a'];
	const labels = ['Очень плохой', 'Плохой', 'Средний', 'Отличный'];
	const label = labels[level - 1] + ' сигнал, ' + dbm + ' dBm';
	return E('span', {
		title: label, 'aria-label': label, role: 'img',
		style: 'display:inline-flex;align-items:center;gap:.45em;white-space:nowrap'
	}, [
		E('span', { 'aria-hidden': 'true', style: 'display:inline-flex;align-items:end;gap:2px;height:16px' },
			[1, 2, 3, 4].map(bar => E('span', {
				style: 'width:4px;border-radius:1px;height:' + (bar * 4) + 'px;background:' +
					(bar <= level ? colors[level - 1] : 'currentColor') + ';opacity:' + (bar <= level ? 1 : .19)
			}))),
		E('span', {}, dbm + ' dBm')
	]);
}

function field(label, control) {
	return E('label', { style: 'display:inline-flex;gap:.45em;align-items:center;margin:.35em .8em .35em 0' },
		[E('span', {}, label), control]);
}

function button(label, callback, style) {
	return E('button', { type: 'button', class: 'cbi-button ' + (style || ''), click: ui.createHandlerFn(null, callback) }, label);
}

return view.extend({
	load: status,
	render(data) {
		let active = false;
		let busy = false;
		let networks = [];
		let details = new Map();
		let wpsFrames = new Map();
		let signature = '';
		let selected = '';
		let interfaces = new Map();
		let radios = {};
		let capture = null;
		let activeCapture = null;
		let activeMode = '';
		let activeJob = '';
		let stopping = false;
		let observedCapture = null;
		let liveClients = [];
		let liveSignature = '';
		const iface = E('select', { class: 'cbi-input-select' });
		const band = E('select', { class: 'cbi-input-select' }, [
			E('option', { value: 'abg' }, '2,4 и 5 ГГц'),
			E('option', { value: 'bg' }, '2,4 ГГц'),
			E('option', { value: 'a' }, '5 ГГц')
		]);
		const seconds = E('input', { type: 'number', min: 5, max: 120, value: 15, style: 'width:6em' });
		const count = E('input', {
			type: 'number', min: 1, max: 10, value: 3, style: 'width:5em',
			title: 'Значение передаётся в aireplay-ng как число групп кадров deauth'
		});
		const filter = E('input', { type: 'search', placeholder: 'SSID или BSSID' });
		const clientsOnly = E('input', { type: 'checkbox' });
		const sorting = [];
		const columns = [
			['ssid', 'SSID'], ['mac', 'BSSID'], ['channel', 'Канал'], ['signal', 'Сигнал'],
			['security', 'Защита'], ['wps', 'WPS'], ['clients', 'Клиенты']
		];
		const station = E('select', { class: 'cbi-input-select' });
		const results = E('div');
		const selection = E('div');
		const progress = E('div', { 'aria-live': 'polite' });
		const badge = E('span', { class: 'wfl-chip' }, 'Подключение…');
		const summary = E('div', { class: 'wfl-stats' });
		const diagnostics = E('pre', { style: 'white-space:pre-wrap;max-height:19em;overflow:auto' });
		const handshakeStatus = E('p', { 'aria-live': 'polite' });
		const info = E('pre', { style: 'white-space:pre-wrap;max-height:19em;overflow:auto' });
		const interfaceSummary = E('div', { class: 'wfl-device' });
		const monitorStatus = E('span', { class: 'wfl-monitor' });

		function selectedNetwork() {
			return networks.find(row => row.mac === selected);
		}

		function controls() {
			const row = selectedNetwork();
			const disabled = active || busy;
			const device = interfaces.get(iface.value);
			const type = device && device.type;
			const monitorable = type === 'AP' || type === 'managed';
			const scannable = ['AP', 'managed', 'mesh point', 'P2P-client', 'P2P-GO', 'P2P-device'].includes(type);
			for (const control of [iface, band, seconds, clearButton])
				control.disabled = disabled;
			surveyButton.disabled = disabled || !monitorable;
			detailsButton.disabled = disabled || !scannable;
			captureButton.disabled = disabled || !monitorable || !row || !(Number(row.channel) > 0);
			const canQueue = activeCapture && row && activeCapture.bssid === row.mac && activeCapture.accepts;
			deauthButton.disabled = busy || stopping || !station.value || (active ? !canQueue : captureButton.disabled);
			deauthButton.textContent = active ? 'Deauth во время захвата' : 'Deauth и захват';
			stopButton.disabled = !activeJob || busy || stopping;
			stopCaptureButton.disabled = !activeJob || busy || stopping || !['capture', 'deauth'].includes(activeMode);
			downloadButton.disabled = disabled || !capture;
			clearCapsButton.disabled = disabled;
		}

		function drawInterface() {
			const device = interfaces.get(iface.value);
			const radio = device && (radios[device.phy] || {});
			const supported = radio && (radio.modes || '').split(/\s+/).includes('monitor');
			monitorStatus.textContent = !device ? 'Monitor mode: нет интерфейса' :
				device.type === 'monitor' ? 'Monitor mode: активен' :
				!radio.modes ? 'Monitor mode: поддержка неизвестна' :
				!supported ? 'Monitor mode: не поддерживается драйвером' :
				['AP', 'managed'].includes(device.type) ? 'Monitor mode: поддерживается' :
				'Monitor mode: радио поддерживает, запуск из этого режима недоступен';
			monitorStatus.dataset.tone = supported || device?.type === 'monitor' ? 'success' : '';
			const property = key => device?.raw.match(new RegExp('^\\s*' + key + ' (.+)$', 'm'))?.[1];
			const channel = property('channel')?.match(/^(\d+) \((\d+) MHz\), width: (\d+) MHz/);
			const mode = device && ({ AP: 'Точка доступа', managed: 'Wi-Fi клиент', monitor: 'Мониторинг' }[device.type] || device.type);
			const fields = pairs => table(['Параметр', 'Значение'], pairs.filter(([, value]) => value));
			interfaceSummary.replaceChildren(device ? fields([
				['Режим', mode],
				['Сеть', property('ssid')],
				['Канал', channel ? channel[1] : property('channel')],
				['Частота', channel && channel[2] + ' МГц'],
				['Ширина', channel && channel[3] + ' МГц'],
				['MAC-адрес', property('addr')],
				['Радио', device.phy],
				['Драйвер', radio.driver],
				['Мощность передачи', property('txpower')],
				['ID оборудования', radio.hardware?.trim().replace(/\s+/, ':')],
				['Режимы драйвера', radio.modes?.trim().replace(/\s+/g, ', ')]
			]) : E('p', {}, 'Интерфейсы Wi-Fi не обнаружены.'));
			controls();
		}

		async function invoke(mode) {
			const row = selectedNetwork();
			busy = true;
			controls();
			try {
				const result = mode === 'stop' ? await stop(activeJob) : mode === 'clear' ? await clear() :
					mode === 'clearCaps' ? await clearCaps() :
					mode === 'deauth' && activeCapture && row ?
						await requestDeauth(activeCapture.job, row.mac, station.value, Number(count.value)) :
					await start(iface.value, mode, band.value, Number(seconds.value),
						Number(row && row.channel) || 0, row ? row.mac : '', station.value,
						Number(count.value));
				if (result.error)
					throw new Error(result.error);
				if (mode === 'clear') {
					networks = [];
					details = new Map();
					selected = signature = '';
					draw();
				}
				update(await status());
				if (mode === 'stop' || mode === 'clearCaps')
					progress.textContent = result.message;
			}
			catch (error) {
				ui.addNotification(null, E('p', {}, error.message), 'danger');
			}
			finally {
				busy = false;
				controls();
			}
		}

		const surveyButton = button('Сканировать в monitor mode', () => invoke('survey'), 'cbi-button-action');
		const detailsButton = button('Запросить статус WPS и параметры wi-fi сетей', () => invoke('details'));
		const stopButton = button('Остановить', () => invoke('stop'));
		const stopCaptureButton = button('Остановить захват CAP', () => invoke('stop'));
		const clearCapsButton = button('Удалить все CAP', () => invoke('clearCaps'), 'cbi-button-negative');
		const clearButton = button('Очистить результаты', () => invoke('clear'));
		const captureButton = button('Пассивный захват CAP', () => invoke('capture'));
		const deauthButton = button('Deauth и захват', () => invoke('deauth'), 'cbi-button-negative');
		const downloadButton = button('Скачать CAP', async () => {
			const file = capture;
			if (!file)
				return;
			busy = true;
			controls();
			try {
				const blocks = [];
				let received = 0;
				for (let chunk = 0; received < file.size; chunk++) {
					const result = await download(file.job, chunk);
					if (result.error || !result.data)
						throw new Error(result.error || 'Получен неполный файл');
					const bytes = Uint8Array.from(atob(result.data), char => char.charCodeAt(0));
					blocks.push(bytes);
					received += bytes.length;
				}
				if (received !== file.size)
					throw new Error('Размер файла изменился');
				const url = URL.createObjectURL(new Blob(blocks, { type: 'application/vnd.tcpdump.pcap' }));
				const link = E('a', { href: url, download: 'wifi-lab-' + file.job + '.cap' });
				document.body.appendChild(link);
				link.click();
				link.remove();
				window.setTimeout(() => URL.revokeObjectURL(url), 1000);
			}
			catch (error) {
				ui.addNotification(null, E('p', {}, error.message), 'danger');
			}
			finally {
				busy = false;
				controls();
			}
		}, 'cbi-button-action');

		function drawSelection() {
			const row = selectedNetwork();
			const clients = row && activeCapture && activeCapture.bssid === row.mac && liveClients.length ?
				liveClients : row ? row.clients : [];
			const prior = station.value;
			station.replaceChildren(E('option', { value: '' }, 'Выберите клиента'));
			if (row)
				station.appendChild(E('option', { value: 'all' }, 'Все клиенты (broadcast)'));
			for (const client of clients)
				station.appendChild(E('option', { value: client.mac }, client.mac));
			if ([...station.options].some(option => option.value === prior))
				station.value = prior;
			selection.replaceChildren(row ? E('div', { class: 'wfl-summary' }, [
				E('strong', {}, row.ssid || 'SSID неизвестен'),
				E('code', {}, row.mac),
				E('span', { class: 'wfl-chip' }, row.channel ? 'Канал ' + row.channel : 'Канал неизвестен'),
				E('span', { class: 'wfl-chip' }, 'Клиенты: ' + clients.length)
			]) : E('p', { class: 'wfl-sub' }, 'Нажмите на название сети, чтобы увидеть клиентов и действия.'));
			if (row && clients.length)
				selection.appendChild(table(['MAC клиента', 'Сигнал', 'Кадры', 'Последний кадр'],
					clients.map(client => [client.mac, signal(client.signal), client.packets, client.last])));
			info.textContent = row && details.has(row.mac) ? details.get(row.mac).raw : 'Данные iw для выбранного BSSID отсутствуют.';
			controls();
		}

		function draw() {
			const search = filter.value.toLowerCase().trim();
			const rows = networks.filter(row => (!clientsOnly.checked || row.clients.length) &&
				((row.ssid || '') + ' ' + row.mac).toLowerCase().includes(search));
			rows.sort((a, b) => {
				for (const { key, desc } of sorting) {
					const left = sortValue(a, key);
					const right = sortValue(b, key);
					const missing = Number(left === null) - Number(right === null);
					if (missing)
						return missing;
					if (left === null)
						continue;
					const difference = typeof left === 'number' ? left - right :
						left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' });
					if (difference)
						return desc ? -difference : difference;
				}
				return a.mac.localeCompare(b.mac);
			});
			summary.replaceChildren(...[
				'Точки: ' + networks.length,
				'С клиентами: ' + networks.filter(row => row.clients.length).length,
				'WPS: ' + networks.filter(row => ['yes', 'selected', 'locked'].includes(wpsStatus(row.mac))).length
			].map(label => E('span', { class: 'wfl-chip' }, label)));
			results.replaceChildren(rows.length ? table(columns.map(sortHeader), rows.map(row => [
				button(row.ssid || 'SSID неизвестен', () => {
					if (selected !== row.mac)
						station.value = '';
					selected = row.mac;
					draw();
				}, 'wfl-name'), E('code', {}, row.mac), row.channel || '—', signal(row.signal), row.security || '—',
				wpsCell(row.mac),
				String(row.clients.length)
			]), rows.findIndex(row => row.mac === selected)) : E('p', { class: 'wfl-sub' },
				networks.length ? 'По фильтру ничего не найдено.' : 'Запустите сканирование, чтобы увидеть точки доступа.'));
			drawSelection();
		}

		function sortValue(row, key) {
			switch (key) {
			case 'channel': return Number(row.channel) > 0 ? Number(row.channel) : null;
			case 'signal': return Number(row.signal) < -1 ? Number(row.signal) : null;
			case 'clients': return row.clients.length;
			case 'wps': {
				const state = wpsStatus(row.mac);
				return state ? Number(state !== 'no') : null;
			}
			default: return row[key]?.trim() || null;
			}
		}

		function sortHeader([key, label]) {
			const index = sorting.findIndex(item => item.key === key);
			const current = sorting[index];
			const firstDescending = ['signal', 'wps', 'clients'].includes(key);
			const arrow = current ? (current.desc ? '↓' : '↑') : '↕';
			const priority = current && sorting.length > 1 ? String(index + 1) : '';
			const description = current ? ', ' + (current.desc ? 'по убыванию' : 'по возрастанию') +
				(priority ? ', приоритет ' + priority : '') : '';
			return E('button', {
				type: 'button', class: 'wfl-sort', 'data-sort': key,
				'aria-label': 'Сортировать: ' + label + description,
				title: 'Клик добавляет колонку, меняет направление или убирает критерий.',
				click: () => {
					if (!current)
						sorting.push({ key, desc: firstDescending });
					else if (current.desc === firstDescending)
						current.desc = !current.desc;
					else
						sorting.splice(index, 1);
					draw();
					results.querySelector('[data-sort="' + key + '"]')?.focus({ preventScroll: true });
				}
			}, [label, E('span', { 'aria-hidden': 'true' }, arrow + priority)]);
		}

		function wpsStatus(mac) {
			const frame = wpsFrames.get(mac);
			return frame && frame !== 'no' ? frame : details.get(mac)?.wps ? 'yes' :
				frame === 'no' || details.has(mac) ? 'no' : '';
		}

		function wpsCell(mac) {
			const state = wpsStatus(mac);
			const label = { yes: 'WPS объявлен в кадрах', selected: 'Окно регистрации активно', locked: 'Регистрация заблокирована' }[state];
			return label ? E('span', { style: 'color:#16a34a', title: label }, 'Включён') :
				state === 'no' ? E('span', { style: 'color:#dc2626', title: 'WPS не объявлен в полученных кадрах' }, 'Выключен') :
					E('span', { class: 'wfl-sub' }, 'Нет служебных кадров');
		}

		function update(next) {
			const previous = iface.value;
			active = !!next.active;
			activeJob = active ? (next.job || '') : '';
			stopping = !!next.stopping;
			activeMode = active ? next.mode : '';
			activeCapture = active && next.mode === 'capture' ? {
				job: next.job, bssid: next.capture_bssid, accepts: !!next.accepts_deauth
			} : null;
			const live = activeCapture ? (next.live_csv || '') : '';
			if (live !== liveSignature) {
				liveSignature = live;
				liveClients = (csvRows(live).find(row => row.mac === activeCapture?.bssid) || {}).clients || [];
				drawSelection();
			}
			capture = next.capture_job && next.capture_size > 0 ? { job: next.capture_job, size: next.capture_size } : null;
			interfaces = wirelessInterfaces(next.interfaces || '');
			radios = next.radios || {};
			if (!active || !iface.options.length || !interfaces.has(previous)) {
				const choices = [...interfaces].map(([name, device]) =>
					E('option', { value: name }, name + ' · ' + device.phy + ' · ' + device.type));
				iface.replaceChildren(...choices);
				if ([...iface.options].some(option => option.value === previous))
					iface.value = previous;
			}
			const snapshot = (next.csv || '') + '\u0000' + (next.details || '') + '\u0000' + (next.wps || '');
			if (snapshot !== signature) {
				signature = snapshot;
				networks = csvRows(next.csv || '');
				details = scanDetails(next.details || '');
				wpsFrames = new Map((next.wps || '').split('\n').filter(Boolean).map(line => line.split(/\s+/)));
				draw();
			}
			const verified = !!next.handshake || /\bWPA \([1-9]\d* handshake/i.test(next.verification || '');
			const noHandshake = /0 handshake|no EAPOL|\bWPA[23]?\b/i.test(next.verification || '') && !verified;
			const capturing = active && ['capture', 'deauth'].includes(next.mode);
			handshakeStatus.replaceChildren(capturing && !verified ?
				'Идёт захват. WPA-handshake пока не найден.' :
				capture ? E('span', {
					class: 'wfl-chip', 'data-tone': verified ? 'success' : noHandshake ? 'warning' : ''
				}, verified ? 'WPA-handshake пойман' + (capturing ? ' · захват продолжается' : '') :
					noHandshake ? 'WPA-handshake не найден' : 'Результат проверки недоступен') :
					'Нет сохранённого CAP.');
			const failed = /не удалось|код [1-9]/i.test(next.result || '');
			const operation = { survey: 'Сканирование', details: 'Параметры и WPS', capture: 'Захват CAP', deauth: 'Тест deauth' }[next.mode];
			if (active && ['capture', 'deauth'].includes(next.mode) && next.job)
				observedCapture = next.job;
			if (!active && observedCapture) {
				if (observedCapture === next.job && (verified || noHandshake))
					ui.addNotification(null, E('p', {}, verified ? 'WPA-handshake подтверждён.' : 'WPA-handshake не найден в захвате.'),
						verified ? 'info' : 'warning');
				observedCapture = null;
			}
			badge.hidden = !active;
			badge.textContent = active ? (next.restoring ? 'Восстановление Wi-Fi…' :
				stopping ? 'Остановка…' : (operation || 'Подготовка') + '…') : '';
			badge.dataset.tone = active ? 'running' : '';
			progress.textContent = active ? (next.result || 'Подготовка…') : failed ? next.result :
				'Выберите интерфейс и запустите сканирование.';
			diagnostics.textContent = [next.verification, next.capture, next.error, next.capture_error, next.replay, next.monitor].filter(Boolean).join('\n\n');
			drawInterface();
		}

		filter.addEventListener('input', draw);
		clientsOnly.addEventListener('change', draw);
		station.addEventListener('change', controls);
		iface.addEventListener('change', drawInterface);
		const page = E('div', { class: 'wfl' }, [
			E('style', {}, styles),
			E('section', { class: 'wfl-card' }, [
				E('div', { class: 'wfl-head' }, [E('h3', {}, 'Радио и сканирование'), badge]),
				E('p', { class: 'wfl-sub' }, 'В режиме мониторинга точка доступа временно отключается. Управляйте роутером по Ethernet.'),
				E('div', {}, [field('Интерфейс', iface), field('Диапазон', band), field('Время сканирования Wi-Fi сетей (сек.)', seconds)]),
				E('p', { class: 'wfl-sub' }, 'Доступное время сканирования Wi-Fi сетей в monitor mode от 5 до 120 секунд. Сканирование можно завершить досрочно с помощью кнопки "Остановить"'),
				E('div', { class: 'wfl-summary' }, monitorStatus),
				interfaceSummary,
				E('div', { class: 'wfl-actions' }, [surveyButton, detailsButton, stopButton]),
				progress
			]),
			E('section', { class: 'wfl-card' }, [
				E('h3', {}, 'Точки доступа'),
				summary,
				E('div', { class: 'wfl-filters' }, [
					E('label', { class: 'wfl-filter' }, [E('span', {}, 'Поиск по сети'), filter]),
					E('label', { class: 'wfl-filter-check' }, [clientsOnly, E('span', {}, 'Только с клиентами')])
				]),
				results,
				E('p', { class: 'wfl-sub' }, 'Клик по заголовку добавляет критерий, следующий меняет направление, третий убирает его. Цифры у стрелок показывают приоритет.'),
				E('p', { class: 'wfl-sub' }, 'Клиенты учитываются по кадрам, замеченным за время сканирования.')
			]),
			E('section', { class: 'wfl-card' }, [
				E('h3', {}, 'Выбранная точка'), selection,
				E('details', {}, [E('summary', {}, 'Параметры RSN и WPS'), info]),
				E('div', { class: 'wfl-actions' }, [
					field('Получатели deauth', station), field('Количество Deauth пакетов', count), captureButton, deauthButton,
					E('span', { class: 'wfl-sub' }, 'CAP записывается без таймера. Для завершения нажмите «Остановить захват CAP».')
				])
			]),
			E('section', { class: 'wfl-card' }, [
				E('div', { class: 'wfl-head' }, [E('h3', {}, 'Захват и журнал'), E('div', { class: 'wfl-actions' }, [stopCaptureButton, downloadButton, clearCapsButton, clearButton])]),
				handshakeStatus,
				E('details', {}, [E('summary', {}, 'Диагностика операции'), diagnostics])
			])
		]);
		draw();
		update(data);
		poll.add(() => status().then(update).catch(error => {
			badge.hidden = false;
			badge.textContent = 'Нет связи';
			badge.dataset.tone = 'warning';
			progress.textContent = 'Ошибка связи с LuCI: ' + error.message;
		}), 3);
		return page;
	},
	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
