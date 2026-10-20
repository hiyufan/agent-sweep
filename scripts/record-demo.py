"""Record the agent-sweep TUI into an animated SVG (assets/demo.svg).

Runs the real CLI in a pseudo-terminal, replays a few keystrokes, snapshots the
screen with pyte after each one and stitches the snapshots into a CSS-animated SVG.

    python3 -m pip install pyte
    HOME=/path/to/demo-home python3 scripts/record-demo.py assets/demo.svg
"""
import os, pty, select, sys, time
from html import escape
import pyte
from pyte import graphics

# pyte ignores SGR 2 (dim); borrow italics to carry it.
graphics.TEXT[2] = "+italics"

COLS, ROWS = 84, 23
KEYS = [  # (key, pause after, keep frame on screen for seconds)
    (None, 0, 2.2),
    (b"j", 0.15, 0.5), (b"j", 0.15, 0.6),
    (b" ", 0.15, 0.6), (b" ", 0.15, 0.6), (b" ", 0.15, 0.6), (b" ", 0.15, 1.0),
    (b"s", 0.2, 1.6),
    (b"a", 0.2, 1.6),
    (b"\r", 0.2, 1.8),
    (b"y", 1.5, 4.0),
]

out_path = sys.argv[1]
title = sys.argv[2] if len(sys.argv) > 2 else "npx agent-sweeper"
cli = os.path.join(os.path.dirname(__file__), "..", "dist", "cli.js")
pid, fd = pty.fork()
if pid == 0:
    os.environ["COLUMNS"], os.environ["LINES"] = str(COLS), str(ROWS)
    os.execvp("node", ["node", cli])

import fcntl, struct, termios
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", ROWS, COLS, 0, 0))
screen = pyte.Screen(COLS, ROWS)
stream = pyte.ByteStream(screen)

def pump(t):
    end = time.time() + t
    while time.time() < end:
        r, _, _ = select.select([fd], [], [], 0.05)
        if r:
            try:
                stream.feed(os.read(fd, 65536))
            except OSError:
                return

pump(2.5)
frames = []
for key, wait, hold in KEYS:
    if key:
        os.write(fd, key)
    pump(0.4 + wait)
    frames.append(([[screen.buffer[y][x] for x in range(COLS)] for y in range(ROWS)], hold))
os.write(fd, b"q")
pump(0.5)

PALETTE = {"red": "#ff6b6b", "green": "#5af78e", "yellow": "#f3f99d", "brown": "#f3f99d", "cyan": "#57c7ff", "default": "#e6e6e6"}
CW, LH, PAD, TOP = 8.4, 19, 18, 40
W, H = int(COLS * CW + PAD * 2), int(ROWS * LH + TOP + PAD)
total = sum(h for _, h in frames)

def row_svg(cells, y):
    parts, x = [], 0
    while x < COLS:
        c = cells[x]
        x2 = x
        key = (c.fg, c.bold, c.reverse, c.italics)
        # Wide (CJK) characters get their own element so they sit on the terminal grid whatever the font.
        wide = lambda i: ord(cells[i].data[:1] or " ") > 0x2e7f
        while x2 < COLS and (cells[x2].fg, cells[x2].bold, cells[x2].reverse, cells[x2].italics) == key and wide(x2) == wide(x):
            x2 += 1
            if wide(x):
                x2 += 1  # skip the empty cell pyte leaves after a wide character
                break
        text = "".join(cells[i].data for i in range(x, x2))
        fg = PALETTE.get(c.fg, PALETTE["default"])
        px = PAD + x * CW
        if c.reverse:
            parts.append(f'<rect x="{px:.1f}" y="{y - 14}" width="{(x2 - x) * CW:.1f}" height="{LH}" fill="{fg}"/>')
            fg = "#1e1f29"
        if text.strip():
            style = ' font-weight="bold"' if c.bold else ""
            opacity = ' opacity="0.55"' if c.italics else ""
            parts.append(f'<text x="{px:.1f}" y="{y}" fill="{fg}"{style}{opacity} xml:space="preserve">{escape(text)}</text>')
        x = x2
    return "".join(parts)

css, groups, t = [], [], 0.0
for i, (buf, hold) in enumerate(frames):
    a, b = t / total * 100, (t + hold) / total * 100
    css.append(f"@keyframes f{i}{{0%,{a:.3f}%{{visibility:hidden}}{a:.3f}%,{b:.3f}%{{visibility:visible}}{b:.3f}%,100%{{visibility:hidden}}}}"
               f".f{i}{{visibility:hidden;animation:f{i} {total:.2f}s steps(1) infinite}}")
    rows = "".join(row_svg(buf[y], TOP + 14 + y * LH) for y in range(ROWS))
    groups.append(f'<g class="f{i}">{rows}</g>')
    t += hold

svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" font-family="ui-monospace,SFMono-Regular,Menlo,Consolas,monospace" font-size="14">
<style>{"".join(css)}</style>
<rect width="{W}" height="{H}" rx="10" fill="#1e1f29"/>
<circle cx="22" cy="20" r="6" fill="#ff5f57"/><circle cx="42" cy="20" r="6" fill="#febc2e"/><circle cx="62" cy="20" r="6" fill="#28c840"/>
<text x="{W / 2}" y="25" fill="#8b8d98" text-anchor="middle" font-size="13">{escape(title)}</text>
{"".join(groups)}
</svg>'''
os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
open(out_path, "w").write(svg)
print(f"{len(frames)} frames, {total:.1f}s, {len(svg) // 1024} KB -> {out_path}")
