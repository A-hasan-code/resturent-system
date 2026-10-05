"""Generate PixalBotics Restaurant icons for web, desktop, and Android."""
from __future__ import annotations

from pathlib import Path

from PIL import Image

SRC = Path(
    r"C:\Users\aliha\.cursor\projects\d-resturent-system\assets"
    r"\c__Users_aliha_AppData_Roaming_Cursor_User_workspaceStorage_"
    r"9f8f30072c7fa1b83c2722dbc82bcb77_images_Blue_Geometric_Company_Logo-"
    r"46f43608-f25e-49fe-9aac-f4bb070933a3.png"
)
ROOT = Path(r"d:\resturent system")


def save_resized(img: Image.Image, path: Path, size: int, bg=(0, 0, 0)) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    out = Image.new("RGB", (size, size), bg)
    copy = img.copy()
    copy.thumbnail((size, size), Image.Resampling.LANCZOS)
    out.paste(copy, ((size - copy.width) // 2, (size - copy.height) // 2))
    out.save(path, "PNG", optimize=True)
    print("wrote", path, size)


def make_adaptive_fg(mark: Image.Image, size: int) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    content = int(size * 0.72)
    scaled = mark.copy()
    scaled.thumbnail((content, content), Image.Resampling.LANCZOS)
    canvas.paste(
        scaled,
        ((size - scaled.width) // 2, (size - scaled.height) // 2),
        scaled if scaled.mode == "RGBA" else None,
    )
    return canvas


def make_launcher(master: Image.Image, size: int) -> Image.Image:
    out = Image.new("RGB", (size, size), (0, 0, 0))
    copy = master.copy()
    copy.thumbnail((size, size), Image.Resampling.LANCZOS)
    out.paste(copy, ((size - copy.width) // 2, (size - copy.height) // 2))
    return out


def main() -> None:
    # Keep the source artwork as provided (full black canvas).
    src = Image.open(SRC).convert("RGBA")
    icon_master = Image.new("RGB", src.size, (0, 0, 0))
    icon_master.paste(src, (0, 0), src)
    w, h = src.size

    save_resized(icon_master, ROOT / "apps/web/public/icons/icon-192.png", 192)
    save_resized(icon_master, ROOT / "apps/web/public/icons/icon-512.png", 512)
    save_resized(icon_master, ROOT / "apps/desktop/assets/icon.png", 512)

    # Adaptive foreground: graphic mark only (skip lower text band).
    mark_rgb = icon_master.crop((int(w * 0.08), int(h * 0.05), int(w * 0.92), int(h * 0.68)))
    mark = mark_rgb.convert("RGBA")
    # Punch pure-black to transparent so adaptive bg shows through.
    px = mark.load()
    mw, mh = mark.size
    for y in range(mh):
        for x in range(mw):
            r, g, b, a = px[x, y]
            if r < 12 and g < 12 and b < 12:
                px[x, y] = (0, 0, 0, 0)

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
        make_launcher(icon_master, launcher).save(d / "ic_launcher.png", "PNG", optimize=True)
        make_launcher(icon_master, launcher).save(d / "ic_launcher_round.png", "PNG", optimize=True)
        make_adaptive_fg(mark, fg).save(d / "ic_launcher_foreground.png", "PNG", optimize=True)
        print("android", dens, launcher, fg)

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
        canvas = Image.new("RGB", (tw, th), (0, 0, 0))
        side = int(min(tw, th) * 0.55)
        logo = icon_master.copy()
        logo.thumbnail((side, side), Image.Resampling.LANCZOS)
        canvas.paste(logo, ((tw - logo.width) // 2, (th - logo.height) // 2))
        canvas.save(p, "PNG", optimize=True)
        print("splash", p)

    print("done")


if __name__ == "__main__":
    main()
