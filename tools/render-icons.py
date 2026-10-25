#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""BlockCanvas · 图标资产生成器（Pillow / 程序化矢量风重绘）

用法：
    python tools/render-icons.py            # 生成全部图标资产
    python tools/render-icons.py --measure <png>   # 量取参考 PNG 的色值/包围盒/圆角
    python tools/render-icons.py --dump <dir>      # 导出小尺寸预览（含 8× 放大）用于肉眼验收

设计原则：
  · 所有图形都在「256 单位空间」里定义，按 size/256 缩放；
  · 超采样倍数 ss 取 2 的幂且保证 size*ss 是 256 的整数倍 —— 于是所有坐标在
    超采样网格上都是整数，最后用 Image.BOX（面积平均）一次缩到目标尺寸，
    得到的就是精确覆盖率：边缘锐利、内部是纯色 alpha=255、无 LANCZOS 振铃；
  · 16/24/32 px 另外用「像素对齐」的手调布局（块尺寸/间距取整），避免小图标糊成一团。

产出：
  build/icon.png (1024)  build/icon.ico (16/24/32/48/64/128/256)
  src/renderer/assets/logo-{16,32,48,64,128,256,512}.png
  build/bcproj.png (256) build/bcproj.ico (16/24/32/48/64/128/256)
  src/renderer/assets/bcproj-{32,128}.png
"""
from __future__ import annotations

import argparse
import math
import pathlib
import sys
from collections import Counter

from PIL import Image, ImageDraw, ImageFilter

ROOT = pathlib.Path(__file__).resolve().parent.parent
ASSETS = ROOT / "src" / "renderer" / "assets"
BUILD = ROOT / "build"

# ---------------------------------------------------------------------------
# 一、三色 Logo：实测色值与几何（256 单位空间）
# ---------------------------------------------------------------------------
# 色值来源：2026-10-24 用 Pillow 对原 src/renderer/assets/logo-512.png 逐像素采样，
# 三种不透明颜色各出现 32352 px 且 RGB 完全一致（纯色、无渐变、无描边）。
# 几何来源：同一张图的三个色块包围盒逐像素量取，与原 logo.svg 一致。
BLUE = (41, 101, 241)    # #2965F1  CSS 蓝   · 左上
ORANGE = (227, 79, 38)   # #E34F26  HTML 橙  · 左下
YELLOW = (247, 223, 30)  # #F7DF1E  JS 黄    · 右下

UNIT = 256
# (x, y, w, h, r, color) —— 实测：三块均为 92×92、圆角 20，位置 (29,29)/(29,135)/(135,135)
LOGO_BLOCKS = (
    (29.0, 29.0, 92.0, 92.0, 20.0, BLUE),
    (29.0, 135.0, 92.0, 92.0, 20.0, ORANGE),
    (135.0, 135.0, 92.0, 92.0, 20.0, YELLOW),
)

# 16 / 24 / 32 px 的像素对齐布局：块尺寸与间距都取整，边距左右严格对称。
# （原始比例换算下来 16px 时块 5.75px、间距 0.875px —— 间距不足 1px 会糊成一片，
#   所以这里把间距放大到整像素，块尺寸同时取整。）
LOGO_SNAPPED = {
    16: dict(block=6, gap=2, origin=1, radius=1.5),   # 6+2+6=14，边距 1/1
    24: dict(block=8, gap=2, origin=3, radius=2.0),   # 8+2+8=18，边距 3/3
    32: dict(block=12, gap=2, origin=3, radius=2.5),  # 12+2+12=26，边距 3/3
}

# ---------------------------------------------------------------------------
# 二、.bcproj 项目文件图标：几何（256 单位空间）
# ---------------------------------------------------------------------------
# 浅色纸面 + 右上折角 + 细边框 + 一点投影；纸面正中放放大的三色方块。
BCPROJ = dict(
    sheet=(30.0, 16.0, 226.0, 232.0),  # L, T, R, B
    radius=24.0,                       # 纸面圆角
    fold=56.0,                         # 右上折角边长
    border=8.0,                        # 纸面描边宽度
    block=66.0,                        # 三色方块边长（占纸面宽度 ~34%，16px 下仍认得出来）
    gap=8.0,                           # 方块间隙
    block_radius=15.0,                 # 方块圆角
    shadow_offset=8.0,                 # 投影下移
    shadow_blur=12.0,                  # 投影模糊半径
    shadow_alpha=58,                   # 投影不透明度
)
PAPER = (255, 255, 255)        # 纸面
PAPER_EDGE = (196, 208, 226)   # #C4D0E2 纸面细边框 / 折痕
FOLD = (228, 236, 246)         # #E4ECF6 折角背面
SHADOW = (15, 23, 42)          # #0F172A 投影基色

# 16 / 24 / 32 px 的像素对齐布局（全部整数像素，边距左右对称）。
# paper=(L,T,R,B) 连续边界；border/fold/block/gap 均为整数像素。
BCPROJ_SNAPPED = {
    16: dict(paper=(1, 1, 15, 15), border=1, fold=5, radius=2, block=4, gap=2,
             block_radius=1, shadow=False),
    24: dict(paper=(2, 2, 22, 22), border=1, fold=7, radius=3, block=6, gap=2,
             block_radius=1.5, shadow=False),
    32: dict(paper=(3, 3, 29, 29), border=1, fold=9, radius=3, block=8, gap=2,
             block_radius=2, shadow=False),
}

ICO_SIZES = (16, 24, 32, 48, 64, 128, 256)
LOGO_SIZES = (16, 32, 48, 64, 128, 256, 512)


# ---------------------------------------------------------------------------
# 工具
# ---------------------------------------------------------------------------
def ss_factor(size: int, minimum: int = 4) -> int:
    """取 2 的幂超采样倍数：>= minimum，且 size*ss 是 256 的整数倍（坐标全落整数格）。"""
    ss = 1
    while ss < minimum or (size * ss) % UNIT != 0:
        ss *= 2
        if ss >= 64:
            break
    return ss


def _rounded_blocks(size: int, blocks, ss: int) -> Image.Image:
    """在 size*ss 画布上画圆角方块，再 LANCZOS 缩到 size。blocks 坐标单位为「目标像素」。"""
    canvas = size * ss
    im = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    for (x, y, w, h, r, col) in blocks:
        box = [x * ss, y * ss, (x + w) * ss - 1, (y + h) * ss - 1]
        d.rounded_rectangle(box, radius=max(r * ss, 0.5), fill=col + (255,))
    if ss > 1:
        # BOX = 面积平均：超采样网格上坐标全是整数，面积平均得到的就是「真实覆盖率」，
        # 既没有 LANCZOS 的振铃（内部像素会被压到 alpha 253、颜色也偏 1），
        # 也没有半像素糊边 —— 小尺寸实测比 LANCZOS 干净得多。
        im = im.resize((size, size), Image.BOX)
    return im


def logo_image(size: int) -> Image.Image:
    """三色 Logo：保持原造型与配色，程序化矢量风重绘。"""
    if size in LOGO_SNAPPED:
        p = LOGO_SNAPPED[size]
        b, g, o, r = p["block"], p["gap"], p["origin"], p["radius"]
        blocks = [
            (o, o, b, b, r, BLUE),
            (o, o + b + g, b, b, r, ORANGE),
            (o + b + g, o + b + g, b, b, r, YELLOW),
        ]
    else:
        s = size / UNIT
        blocks = [(x * s, y * s, w * s, h * s, r * s, c) for (x, y, w, h, r, c) in LOGO_BLOCKS]
    return _rounded_blocks(size, blocks, ss_factor(size))


def _arc(cx, cy, r, a0, a1, steps=32):
    return [
        (cx + r * math.cos(math.radians(a0 + (a1 - a0) * i / steps)),
         cy + r * math.sin(math.radians(a0 + (a1 - a0) * i / steps)))
        for i in range(steps + 1)
    ]


def _page_path(L, T, R, B, r, fold, steps=32):
    """带右上折角的纸张轮廓（顺时针）：圆角矩形，右上角沿对角线切掉。"""
    pts = [(L + r, T), (R - fold, T), (R, T + fold), (R, B - r)]
    pts += _arc(R - r, B - r, r, 0, 90, steps)[1:]
    pts.append((L + r, B))
    pts += _arc(L + r, B - r, r, 90, 180, steps)[1:]
    pts.append((L, T + r))
    pts += _arc(L + r, T + r, r, 180, 270, steps)[1:]
    return pts


def _bcproj_geometry(size: int):
    """返回目标像素单位的 (page_path 参数, 三色方块列表, 投影参数)。"""
    if size in BCPROJ_SNAPPED:
        p = BCPROJ_SNAPPED[size]
        L, T, R, B = p["paper"]
        geom = dict(L=L, T=T, R=R, B=B, r=p["radius"], fold=p["fold"],
                    border=p["border"], shadow=None)
        b, g = p["block"], p["gap"]
        group = b * 2 + g
        x0 = L + (R - L - group) // 2
        y0 = T + (B - T - group) // 2
        blocks = [
            (x0, y0, b, b, p["block_radius"], BLUE),
            (x0, y0 + b + g, b, b, p["block_radius"], ORANGE),
            (x0 + b + g, y0 + b + g, b, b, p["block_radius"], YELLOW),
        ]
        return geom, blocks
    s = size / UNIT
    L, T, R, B = [v * s for v in BCPROJ["sheet"]]
    g = BCPROJ
    geom = dict(L=L, T=T, R=R, B=B, r=g["radius"] * s, fold=g["fold"] * s,
                border=g["border"] * s,
                shadow=(g["shadow_offset"] * s, g["shadow_blur"] * s, g["shadow_alpha"]))
    b, gap = g["block"] * s, g["gap"] * s
    group = b * 2 + gap
    x0 = L + (R - L - group) / 2
    y0 = T + (B - T - group) / 2
    blocks = [
        (x0, y0, b, b, g["block_radius"] * s, BLUE),
        (x0, y0 + b + gap, b, b, g["block_radius"] * s, ORANGE),
        (x0 + b + gap, y0 + b + gap, b, b, g["block_radius"] * s, YELLOW),
    ]
    return geom, blocks


def bcproj_image(size: int) -> Image.Image:
    """`.bcproj` 项目文件图标：折角纸面 + 放大的三色方块。"""
    geom, blocks = _bcproj_geometry(size)
    ss = ss_factor(size)
    n = size * ss
    L, T, R, B = (geom[k] * ss for k in ("L", "T", "R", "B"))
    r, fold, border = geom["r"] * ss, geom["fold"] * ss, geom["border"] * ss

    base = Image.new("RGBA", (n, n), (0, 0, 0, 0))

    # 投影（小尺寸省略，避免糊）
    if geom["shadow"]:
        off, blur, alpha = geom["shadow"]
        mask = Image.new("L", (n, n), 0)
        ImageDraw.Draw(mask).polygon(
            _page_path(L, T + off * ss, R, B + off * ss, r, fold), fill=alpha)
        mask = mask.filter(ImageFilter.GaussianBlur(blur * ss))
        shadow = Image.new("RGBA", (n, n), SHADOW + (0,))
        shadow.putalpha(mask)
        base = Image.alpha_composite(base, shadow)

    d = ImageDraw.Draw(base)
    # 纸面：先用边框色填外轮廓，再用纸色填内缩轮廓 —— 得到宽度精确的细边框
    outer = _page_path(L, T, R, B, r, fold)
    d.polygon(outer, fill=PAPER_EDGE + (255,))
    fi = fold + 0.414 * border          # 内轮廓的对角线内缩量（沿法线偏移 border）
    inner = _page_path(L + border, T + border, R - border, B - border,
                       max(r - border, 0), fi)
    d.polygon(inner, fill=PAPER + (255,))
    # 折角：被折过来的那一角（对角线的左下方三角形）
    d.polygon([(R - border - fi, T + border), (R - border, T + border + fi),
               (R - border - fi, T + border + fi)], fill=FOLD + (255,))

    # 三色方块
    for (x, y, w, h, br, col) in blocks:
        d.rounded_rectangle([x * ss, y * ss, (x + w) * ss - 1, (y + h) * ss - 1],
                            radius=max(br * ss, 0.5), fill=col + (255,))

    if ss > 1:
        base = base.resize((size, size), Image.BOX)   # 同 _rounded_blocks：面积平均，无振铃
    return base


def save_ico(path: pathlib.Path, images: dict) -> None:
    """多尺寸 ICO：每个尺寸都用「该尺寸专用的渲染结果」（而不是统一缩放），小图才锐利。

    bitmap_format="bmp" 强制用经典 32bpp DIB 帧而非 PNG 帧：
    Windows GDI+（System.Drawing.Icon / 部分旧工具）读不了 PNG 压缩帧（≥64 时会抛
    「请求的范围扩展超过了数组的结尾」），DIB 帧才是兼容性最好的选择。
    """
    sizes = sorted(images)
    base = images[sizes[-1]]
    base.save(path, format="ICO", sizes=[(s, s) for s in sizes],
              append_images=[images[s] for s in sizes[:-1]],
              bitmap_format="bmp")


# ---------------------------------------------------------------------------
# 量取参考图（把报告里的数字变成可复现的命令）
# ---------------------------------------------------------------------------
def measure(png: pathlib.Path) -> None:
    im = Image.open(png).convert("RGBA")
    w, h = im.size
    px = im.load()
    cnt = Counter()
    for y in range(h):
        for x in range(w):
            rr, gg, bb, aa = px[x, y]
            if aa > 250:
                cnt[(rr, gg, bb)] += 1
    print(f"# {png}  {w}x{h}")
    for col, num in cnt.most_common(4):
        xs, ys = [], []
        for y in range(h):
            for x in range(w):
                if px[x, y][:3] == col and px[x, y][3] > 250:
                    xs.append(x)
                    ys.append(y)
        x0, y0, x1, y1 = min(xs), min(ys), max(xs), max(ys)
        print(f"color #{col[0]:02X}{col[1]:02X}{col[2]:02X} rgb{col} px={num} "
              f"bbox=({x0},{y0})-({x1},{y1}) size={x1-x0+1}x{y1-y0+1} "
              f"in256=({x0*UNIT/w:.2f},{y0*UNIT/h:.2f},{(x1+1)*UNIT/w:.2f},{(y1+1)*UNIT/h:.2f})")
        # 顶行圆角拟合
        best = None
        rad_span = range(1, max(62, int(w * 0.25)))  # 搜索范围随图幅放大（1024 图上圆角是 80px）
        for rr in rad_span:
            err = 0.0
            for y in range(y0, y0 + rr + 1):
                row = [x for x in range(x0, x1 + 1) if px[x, y][3] > 250]
                if not row:
                    continue
                dy = y - y0
                pred = rr - math.sqrt(max(rr * rr - (rr - dy) ** 2, 0))
                err += (pred - (min(row) - x0)) ** 2
            if best is None or err < best[1]:
                best = (rr, err)
        print(f"    corner radius best-fit = {best[0]} px -> {best[0]*UNIT/w:.2f} in 256 units")


# ---------------------------------------------------------------------------
# 预览导出（肉眼验收）
# ---------------------------------------------------------------------------
def dump(dirpath: pathlib.Path) -> None:
    dirpath.mkdir(parents=True, exist_ok=True)
    ico = Image.open(BUILD / "icon.ico")
    bico = Image.open(BUILD / "bcproj.ico")
    items = {
        "from-icon.png-16": logo_image(16),
        "from-icon.png-32": logo_image(32),
        "from-bcproj.png-16": bcproj_image(16),
        "from-bcproj.png-32": bcproj_image(32),
    }
    for size in (16, 32):
        ico.size = (size, size)
        ico.load()
        items[f"from-icon.ico-{size}"] = ico.convert("RGBA").copy()
        bico.size = (size, size)
        bico.load()
        items[f"from-bcproj.ico-{size}"] = bico.convert("RGBA").copy()
    # 与现有实现对比：现在线上那份 build/icon.png（旧 256 图）缩放出来的 16px
    old = BUILD / "icon.png"
    for name, im in items.items():
        im.save(dirpath / f"{name}.png")
        zoom = im.resize((im.width * 12, im.height * 12), Image.NEAREST)
        bg = Image.new("RGBA", zoom.size, (246, 248, 251, 255))
        bg.alpha_composite(zoom)
        bg.convert("RGB").save(dirpath / f"{name}@12x.png")
    print(f"preview -> {dirpath}  (old icon source kept: {old.exists()})")


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------
def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--measure", metavar="PNG")
    ap.add_argument("--dump", metavar="DIR")
    args = ap.parse_args()

    if args.measure:
        measure(pathlib.Path(args.measure))
        return 0
    if args.dump:
        dump(pathlib.Path(args.dump))
        return 0

    ASSETS.mkdir(parents=True, exist_ok=True)
    BUILD.mkdir(parents=True, exist_ok=True)
    written = []

    # 1) 高清 App 图标
    icon_png = logo_image(1024)
    icon_png.save(BUILD / "icon.png")
    written.append(BUILD / "icon.png")
    save_ico(BUILD / "icon.ico", {s: logo_image(s) for s in ICO_SIZES})
    written.append(BUILD / "icon.ico")

    # 2) 界面用各尺寸 Logo
    for s in LOGO_SIZES:
        p = ASSETS / f"logo-{s}.png"
        logo_image(s).save(p)
        written.append(p)

    # 3) .bcproj 项目文件图标
    bc = bcproj_image(256)
    bc.save(BUILD / "bcproj.png")
    written.append(BUILD / "bcproj.png")
    save_ico(BUILD / "bcproj.ico", {s: bcproj_image(s) for s in ICO_SIZES})
    written.append(BUILD / "bcproj.ico")
    for s in (32, 128):
        p = ASSETS / f"bcproj-{s}.png"
        bcproj_image(s).save(p)
        written.append(p)

    # 4) 读回自检
    print("生成完成，逐个读回校验：")
    for p in written:
        with Image.open(p) as im:
            extra = ""
            if p.suffix.lower() == ".ico":
                sizes = sorted(im.info.get("sizes", []))
                extra = " entries=[" + ",".join(f"{a}x{b}" for a, b in sizes) + "]"
            print(f"  {p.relative_to(ROOT)}  {im.size[0]}x{im.size[1]} {im.mode} "
                  f"{p.stat().st_size} bytes{extra}")
    return 0


if __name__ == "__main__":
    sys.exit(main())