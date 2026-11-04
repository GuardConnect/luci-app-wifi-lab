'use strict';

// Render the actual LuCI view with a minimal DOM/RPC harness and synthetic data.
// Usage: node tools/demo-screenshots.js output-directory
const fs = require('node:fs');
const path = require('node:path');
const destination = process.argv[2];
if (!destination)
	throw new Error('Specify an output directory');
const viewSource = fs.readFileSync(path.join(__dirname, '../htdocs/luci-static/resources/view/wifi-lab.js'), 'utf8');
const rows = [
	['02:00:00:00:00:01', 1, -49, 'WPA2', 'Workshop'],
	['02:00:00:00:00:02', 36, -62, 'WPA3', 'Workshop-5G'],
	['02:00:00:00:00:03', 6, -71, 'WPA2', 'Lab-Guest'],
	['02:00:00:00:00:04', 11, -86, 'WPA2', 'Test-IoT']
];
const csv = rows.map(([mac, channel, power, security, ssid]) =>
	[mac, '', '', channel, 270, security, 'CCMP', 'PSK', power, 15, 1, '', ssid.length, ssid, ''].join(',')).join('\n') +
	'\nStation MAC, First time seen\n' +
	'02:00:00:00:01:01,,12:00:12,-48,31,02:00:00:00:00:01,\n' +
	'02:00:00:00:01:02,,12:00:15,-63,10,02:00:00:00:00:01,\n' +
	'02:00:00:00:01:03,,12:00:19,-70,8,02:00:00:00:00:02,';
const sample = {
	interfaces: 'phy#0\n\tInterface phy0-ap0\n\t\taddr 02:00:00:00:10:01\n\t\tssid Lab Router\n\t\ttype AP\n\t\tchannel 6 (2437 MHz), width: 20 MHz\n\t\ttxpower 12.00 dBm',
	radios: { phy0: { driver: 'mt7921e', hardware: '0x14c3 0x7961', modes: 'managed\nAP\nmonitor' } },
	csv, wps: '02:00:00:00:00:01 yes\n02:00:00:00:00:02 no\n02:00:00:00:00:03 no',
	details: 'BSS 02:00:00:00:00:01(on phy0-ap0)\n\tSSID: Workshop\n\tRSN: CCMP / PSK\n\tWPS: Version 2.0',
	active: false, capture_job: 'job.demo', capture_size: 312299, handshake: true
};
const harness = `
function E(tag, attrs = {}, children = []) {
	const node = document.createElement(tag);
	for (const [key, value] of Object.entries(attrs)) {
		if (typeof value === 'function') node.addEventListener(key, value);
		else node.setAttribute(key, value);
	}
	node.append(...(Array.isArray(children) ? children : [children]));
	return node;
}
const view = { extend: value => value };
const rpc = { declare: () => async () => ({}) };
const poll = { add() {} };
const ui = { createHandlerFn: (_, callback) => callback };
`;
fs.mkdirSync(destination, { recursive: true });
for (const screen of ['overview', 'capture', 'handshake']) {
	const data = screen === 'handshake' ? {
		...sample, active: true, mode: 'capture', job: 'job.demo', capture_bssid: rows[0][0],
		result: 'Мониторинг: phy0-ap0mon'
	} : sample;
	const action = screen === 'capture' ? `
		document.querySelector('.wfl-name').click();
		document.querySelector('.wfl > section').remove();
	` : screen === 'handshake' ? `
		document.querySelector('.wfl-name').click();
		for (const section of [...document.querySelectorAll('.wfl > section')].slice(0, 2)) section.remove();
	` : `
		for (const section of [...document.querySelectorAll('.wfl > section')].slice(1)) section.remove();
	`;
	const html = `<!doctype html><html lang="ru"><meta charset="utf-8"><title>Wi-Fi Lab Demo</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#171e27;color:#e8edf4;font:15px system-ui;color-scheme:dark}
#app{max-width:1220px;margin:auto;padding:22px}header.demo{padding:15px 24px;background:#233142;color:#e8edf4;font-weight:650}
input,select,button{font:inherit;color:inherit}button.cbi-button,input,select{border:1px solid #5b6878;border-radius:5px;background:#263343;padding:6px 10px}
button.cbi-button-action{background:#234f84}button.cbi-button-negative{background:#692e36}button:disabled{opacity:.5}
.table{width:100%;border-collapse:collapse;text-align:left}.table td,.table th{border-bottom:1px solid #44505c}
.table th{background:#223042}.wfl-card{background:#202933}
</style><header class="demo">OpenWrt / Services / Wi-Fi Lab · Demo</header><main id="app"></main><script>
${harness}
const page = (() => { ${viewSource} })();
document.querySelector('#app').append(page.render(${JSON.stringify(data)}));
${action}
</script></html>`;
	fs.writeFileSync(path.join(destination, screen + '.html'), html);
}
