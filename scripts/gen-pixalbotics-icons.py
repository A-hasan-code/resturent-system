"""Generate PixalBotics Restaurant icons for web, desktop, Windows, and Android.

Source artwork is a finished rounded app icon on a light photo background.
The light margin is removed and the rounded corners are filled with the
icon's own teal so every launcher gets a clean square.
"""
from __future__ import annotations

from collections import deque
from pathlib import Path

from PIL import Image

SRC = Path(
    r"C:\Users\aliha\.cursor\projects\d-resturent-system\assets"
    r"\c__Users_aliha_AppData_Roaming_Cursor_User_workspaceStorage_"
    r"9f8f30072c7fa1b83c2722dbc82bcb77_images_icon_app-"
    r"25a69bc5-5d11-4580-875f-cd98ba4e2ce9.jpg"
)
ROOT = Path(r"d:\resturent system")


def is_photo_bg(r: int, g: int, b: int) -> bool:
    """Light gray photo margin and the soft drop shadow around the tile.

    Only used for a flood fill that starts at the image border, so the white
    wordmark inside the icon is never treated as background.
    """
    mx, mn = max(r, g, b), min(r, g, b)
    return mx >= 96 and (mx - mn) <= 36


def flood_outside(img: Image.Image) -> list[list[bool]]:
    w, h = img.size
    px = img.load()
    outside = [[False] * w for _ in range(h)]
    q: deque[tuple[int, int]] = deque()
    for x in range(w):
        q.append((x, 0))
        q.append((x, h - 1))
    for y in range(h):
        q.append((0, y))
        q.append((w - 1, y))
    while q:
        x, y = q.popleft()
        if x < 0 or y < 0 or x >= w or y >= h or outside[y][x]:
            continue
        r, g, b = px[x, y]
        if not is_photo_bg(r, g, b):
            continue
        outside[y][x] = True
        q.append((x + 1, y))
        q.append((x - 1, y))
        q.append((x, y + 1))
        q.append((x, y - 1))
    # Eat the soft gray halo so the tile edge is the teal itself.
    for _ in range(3):
        grow: list[tuple[int, int]] = []
        for y in range(h):
            for x in range(w):
                if outside[y][x]:
                    continue
                r, g, b = px[x, y]
                if not is_photo_bg(r, g, b):
                    continue
                if any(
                    0 <= nx < w and 0 <= ny < h and outside[ny][nx]
                    for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1))
                ):
                    grow.append((x, y))
        for x, y in grow:
            outside[y][x] = True
    # One more pass for the darker anti-aliased rim still stuck to the shadow.
    for _ in range(4):
        grow = []
        for y in range(h):
            for x in range(w):
                if outside[y][x]:
                    continue
                r, g, b = px[x, y]
                mx, mn = max(r, g, b), min(r, g, b)
                if mx - mn > 40 or (r + g + b) < 150:
                    continue
                if any(
                    0 <= nx < w and 0 <= ny < h and outside[ny][nx]
                    for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1))
                ):
                    grow.append((x, y))
        for x, y in grow:
            outside[y][x] = True
    return outside


def sample_teal(img: Image.Image, outside: list[list[bool]]) -> tuple[int, int, int]:
    w, h = img.size
    px = img.load()
    samples: list[tuple[int, int, int]] = []
    for x, y in (
        (w // 2, int(h * 0.08)),
        (w // 2, int(h * 0.92)),
        (int(w * 0.08), h // 2),
        (int(w * 0.92), h // 2),
        (int(w * 0.18), int(h * 0.18)),
        (int(w * 0.82), int(h * 0.18)),
        (int(w * 0.18), int(h * 0.82)),
        (int(w * 0.82), int(h * 0.82)),
    ):
        if outside[y][x]:
            continue
        r, g, b = px[x, y]
        if b >= r and g >= r - 10 and max(r, g, b) < 120:
            samples.append((r, g, b))
    if not samples:
        return (14, 58, 68)
    samples.sort(key=lambda c: c[0] + c[1] + c[2])
    return samples[len(samples) // 2]


def prepare(src: Image.Image) -> tuple[Image.Image, Image.Image, tuple[int, int, int]]:
    img = src.convert("RGB")
    outside = flood_outside(img)
    w, h = img.size
    minx, miny, maxx, maxy = w, h, 0, 0
    for y in range(h):
        row = outside[y]
        for x in range(w):
            if row[x]:
                continue
            if x < minx:
                minx = x
            if y < miny:
                miny = y
            if x > maxx:
                maxx = x
            if y > maxy:
                maxy = y
    teal = sample_teal(img, outside)
    cw, ch = maxx - minx + 1, maxy - miny + 1
    side = max(cw, ch)
    ox, oy = (side - cw) // 2, (side - ch) // 2
    # Transparent corners keep the original rounded tile for the splash.
    rounded = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    rpx = rounded.load()
    src_px = img.load()
    for y in range(ch):
        for x in range(cw):
            if outside[miny + y][minx + x]:
                continue
            r, g, b = src_px[minx + x, miny + y]
            rpx[ox + x, oy + y] = (r, g, b, 255)
    # Launchers want a solid square; the OS applies its own rounding.
    canvas = Image.new("RGB", (side, side), teal)
    canvas.paste(rounded, (0, 0), rounded)
    return canvas, rounded, teal


def save_resized(img: Image.Image, path: Path, size: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    out = img.resize((size, size), Image.Resampling.LANCZOS)
    out.save(path, "PNG", optimize=True)
    print("wrote", path, size)


def hex_color(rgb: tuple[int, int, int]) -> str:
    return "#{:02X}{:02X}{:02X}".format(*rgb)


def main() -> None:
    master, rounded, teal = prepare(Image.open(SRC))
    print("master", master.size, "teal", hex_color(teal))

    save_resized(master, ROOT / "apps/web/public/icons/icon-192.png", 192)
    save_resized(master, ROOT / "apps/web/public/icons/icon-512.png", 512)
    save_resized(master, ROOT / "apps/desktop/assets/icon.png", 512)

    ico_path = ROOT / "packaging/windows/icon.ico"
    ico_path.parent.mkdir(parents=True, exist_ok=True)
    master.save(
        ico_path,
        format="ICO",
        sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    print("wrote", ico_path)

    android = ROOT / "apps/mobile/android/app/src/main/res"
    densities = {
        "mipmap-mdpi": (48, 108),
        "mipmap-hdpi": (72, 162),
        "mipmap-xhdpi": (96, 216),
        "mipmap-xxhdpi": (144, 324),
        "mipmap-xxxhdpi": (192, 432),
    }
    for dens, (launcher, fg) in densities.items():
        d = android / dens
        d.mkdir(parents=True, exist_ok=True)
        save_resized(master, d / "ic_launcher.png", launcher)
        save_resized(master, d / "ic_launcher_round.png", launcher)
        save_resized(master, d / "ic_launcher_foreground.png", fg)

    bg_xml = android / "values/ic_launcher_background.xml"
    bg_xml.write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n'
        "<resources>\n"
        f'    <color name="ic_launcher_background">{hex_color(teal)}</color>\n'
        "</resources>\n",
        encoding="utf-8",
    )
    print("wrote", bg_xml, hex_color(teal))

    for rel in [
        "drawable/splash.png",
        "drawable-port-mdpi/splash.png",
        "drawable-port-hdpi/splash.png",
        "drawable-port-xhdpi/splash.png",
        "drawable-port-xxhdpi/splash.png",
        "drawable-port-xxxhdpi/splash.png",
        "drawable-land-mdpi/splash.png",
        "drawable-land-hdpi/splash.png",
        "drawable-land-xhdpi/splash.png",
        "drawable-land-xxhdpi/splash.png",
        "drawable-land-xxxhdpi/splash.png",
    ]:
        p = android / rel
        if not p.parent.exists():
            continue
        try:
            tw, th = Image.open(p).size
        except Exception:
            tw, th = 480, 480
        # Darker than the tile so the rounded icon still reads as a card.
        splash_bg = tuple(max(0, c // 3) for c in teal)
        canvas = Image.new("RGB", (tw, th), splash_bg)
        side = int(min(tw, th) * 0.62)
        logo = rounded.resize((side, side), Image.Resampling.LANCZOS)
        canvas.paste(logo, ((tw - side) // 2, (th - side) // 2), logo)
        canvas.save(p, "PNG", optimize=True)
        print("splash", p, tw, th)

    print("done")


if __name__ == "__main__":
    main()
