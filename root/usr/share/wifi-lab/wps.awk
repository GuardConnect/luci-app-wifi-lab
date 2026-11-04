# Input: od -An -v -tu1 on airodump-ng's classic PCAP (DLT_IEEE802_11).
function integer(start, width,    n, i) {
	n = 0
	for (i = 0; i < width; i++)
		n = n * 256 + bytes[start + (little ? width - i - 1 : i)]
	return n
}

function inspect(    ap, i, width, end, j, attr, size, flags, registrar, locked) {
	if (packet < 36 || (frame[1] != 128 && frame[1] != 80))
		return
	ap = sprintf("%02x:%02x:%02x:%02x:%02x:%02x", frame[17], frame[18], frame[19], frame[20], frame[21], frame[22])
	for (i = 37; i + 1 <= packet; i = end) {
		width = frame[i + 1]
		end = i + 2 + width
		if (end > packet + 1)
			break
		if (frame[i] != 221 || width < 4 || frame[i+2] != 0 || frame[i+3] != 80 ||
		    frame[i+4] != 242 || frame[i+5] != 4)
			continue
		flags = "yes"
		for (j = i + 6; j + 3 < end; j += size + 4) {
			attr = frame[j] * 256 + frame[j+1]
			size = frame[j+2] * 256 + frame[j+3]
			if (j + 4 + size > end)
				break
			if (size < 1)
				continue
			if (attr == 4161 && frame[j+4] == 1)
				registrar = 1
			if (attr == 4183 && frame[j+4] == 1)
				locked = 1
		}
	}
	if (flags) {
		enabled[ap] = 1
		if (registrar) selected[ap] = 1
		if (locked) setup_locked[ap] = 1
	}
	if (i == packet + 1)
		observed[ap] = 1
}

{
	for (column = 1; column <= NF; column++) {
		byte = $column + 0
		if (phase == 0) {
			bytes[++offset] = byte
			if (offset == 24) {
				little = bytes[1] == 212 || bytes[1] == 77
				if (integer(21, 4) != 105)
					exit 1
				phase = 1
				offset = 0
			}
		} else if (phase == 1) {
			bytes[++offset] = byte
			if (offset == 16) {
				packet = integer(9, 4)
				if (packet > 65535)
					exit 1
				phase = packet > 0 ? 2 : 1
				offset = 0
			}
		} else {
			offset++
			if (offset == 1)
				management = byte == 128 || byte == 80
			if (management)
				frame[offset] = byte
			if (offset == packet) {
				if (management)
					inspect()
				phase = 1
				offset = 0
			}
		}
	}
}

END {
	for (ap in enabled)
		print ap, setup_locked[ap] ? "locked" : selected[ap] ? "selected" : "yes"
	for (ap in observed)
		if (!(ap in enabled))
			print ap, "no"
}
