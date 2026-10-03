#!/usr/bin/env python3
# Loyalty Tree - TAP-style dynamic stamp showcase patch
# Run from the Loyalty Tree project root:
#   python3 patch_stamp_showcase_layout.py
# The script creates .bak backups before editing.

from pathlib import Path
import re
import sys

ROOT = Path.cwd()

def first_existing(paths):
    for p in paths:
        if p.exists():
            return p
    return None

main_path = first_existing([
    ROOT / "main.py",
    ROOT / "backend" / "main.py",
    ROOT / "app" / "main.py",
])

jsx_path = first_existing([
    ROOT / "LoyaltyCardCustomizer.jsx",
    ROOT / "src" / "LoyaltyCardCustomizer.jsx",
    ROOT / "frontend" / "src" / "LoyaltyCardCustomizer.jsx",
    ROOT / "frontend" / "src" / "components" / "LoyaltyCardCustomizer.jsx",
    ROOT / "frontend" / "src" / "pages" / "LoyaltyCardCustomizer.jsx",
    ROOT / "LoyaltyCardCustomizer_dynamic_progress.jsx",
])

if not main_path:
    print("ERROR: main.py not found.")
    print("Place/run this script from the Loyalty Tree project root.")
    sys.exit(1)

if not jsx_path:
    print("ERROR: LoyaltyCardCustomizer.jsx not found.")
    print("Place/run this script from the Loyalty Tree project root.")
    sys.exit(1)

print("Backend :", main_path)
print("Frontend:", jsx_path)

def backup(path):
    bak = path.with_suffix(path.suffix + ".bak")
    if not bak.exists():
        bak.write_text(path.read_text(encoding="utf-8"), encoding="utf-8")
        print("Backup  :", bak)

backup(main_path)
backup(jsx_path)

backend = main_path.read_text(encoding="utf-8")

new_backend_func = r'''def _draw_dynamic_progress_row(
    img: "Image.Image",
    progress_state: Optional[dict],
    center_y: int,
    primary_color: str,
    fallback_icon: str = 'star',
    filled_icon_url: Optional[str] = None,
    empty_icon_url: Optional[str] = None,
) -> bool:
    # Large TAP-style Wallet progress showcase.
    from PIL import ImageDraw

    state = progress_state or {}
    try:
        slots = max(1, min(20, int(state.get('slots') or 0)))
        filled_slots = max(0, min(slots, int(state.get('filled_slots') or 0)))
    except Exception:
        return False

    if not slots:
        return False

    draw_layer = Image.new('RGBA', HERO_SIZE, (0, 0, 0, 0))
    draw = ImageDraw.Draw(draw_layer)

    filled_remote = _load_remote_wallet_image(filled_icon_url)
    empty_remote = _load_remote_wallet_image(empty_icon_url)
    custom_art = filled_remote is not None or empty_remote is not None

    rows = 1 if slots <= 10 else 2
    cols = slots if rows == 1 else (slots + 1) // 2

    side_pad = 70
    gap_x = 16 if cols <= 8 else 10
    gap_y = 12
    available_w = HERO_SIZE[0] - side_pad * 2
    size = int((available_w - gap_x * (cols - 1)) / cols)

    if rows == 1:
        size = max(54, min(92, size))
    else:
        size = max(44, min(72, size))

    total_w = cols * size + gap_x * (cols - 1)
    start_x = (HERO_SIZE[0] - total_w) // 2
    row_height = size + gap_y
    total_h = size if rows == 1 else size * 2 + gap_y
    start_y = int(center_y - total_h / 2)

    if not custom_art:
        bg_pad_x = 22
        bg_pad_y = 14
        draw.rounded_rectangle(
            (
                start_x - bg_pad_x,
                start_y - bg_pad_y,
                start_x + total_w + bg_pad_x,
                start_y + total_h + bg_pad_y,
            ),
            radius=max(22, size // 2),
            fill=(0, 0, 0, 52),
            outline=(255, 255, 255, 32),
            width=1,
        )

    filled_tile = _fit_transparent_icon(filled_remote, size) if filled_remote is not None else None
    empty_tile = _fit_transparent_icon(empty_remote, size) if empty_remote is not None else None

    if filled_tile is not None and empty_tile is None:
        empty_tile = _faded_icon(filled_tile, .28)
    elif empty_tile is not None and filled_tile is None:
        filled_tile = empty_tile

    accent = _hex_to_rgb(primary_color)

    for i in range(slots):
        row = 0 if rows == 1 else (i // cols)
        col = i if rows == 1 else (i % cols)

        x0 = start_x + col * (size + gap_x)
        y0 = start_y + row * row_height

        if rows == 1 and slots == 8:
            y0 += -10 if i % 2 == 0 else 10

        x1 = x0 + size
        y1 = y0 + size
        filled = i < filled_slots
        custom_tile = filled_tile if filled else empty_tile

        if custom_tile is not None:
            draw_layer.alpha_composite(custom_tile, (x0, y0))
            continue

        if filled:
            draw.ellipse(
                (x0, y0, x1, y1),
                fill=(255, 255, 255, 238),
                outline=(255, 255, 255, 255),
                width=max(1, size // 18),
            )
            _draw_stamp_symbol(
                draw,
                fallback_icon,
                (x0, y0, x1, y1),
                fill=(*accent, 255),
            )
        else:
            draw.ellipse(
                (x0, y0, x1, y1),
                fill=(255, 255, 255, 22),
                outline=(255, 255, 255, 115),
                width=max(1, size // 16),
            )

    img.alpha_composite(draw_layer)
    return True

'''

backend_pattern = re.compile(
    r'def _draw_dynamic_progress_row\([\s\S]*?(?=def _draw_stamp_progress_row\()',
    re.MULTILINE
)

backend_new, count = backend_pattern.subn(new_backend_func, backend, count=1)
if count != 1:
    print("ERROR: Could not locate _draw_dynamic_progress_row() in main.py")
    sys.exit(1)

backend_new = backend_new.replace(
    "center_y=168 if include_text_overlay else 170,",
    "center_y=154 if include_text_overlay else 168,",
    1
)

main_path.write_text(backend_new, encoding="utf-8")
print("Patched backend.")

frontend = jsx_path.read_text(encoding="utf-8")

new_preview_func = r'''  const renderDynamicProgressPreview = (compact = false) => {
    if (!dynamicBannerActive) return null
    const filledUrl = String(form.wallet_progress_filled_icon_url || '').trim()
    const emptyUrl = String(form.wallet_progress_empty_icon_url || '').trim()
    const fallbackFilled = effectiveWalletProgressType === 'stamps' ? selectedStampIcon.symbol : '●'
    const totalSlots = Math.min(20, dynamicProgressPreview.slots)
    const useTwoRows = totalSlots > 10
    const cols = useTwoRows ? Math.ceil(totalSlots / 2) : totalSlots
    const cellSize = compact
      ? (totalSlots <= 8 ? 38 : totalSlots <= 10 ? 32 : 28)
      : (totalSlots <= 8 ? 54 : totalSlots <= 10 ? 46 : 38)

    return (
      <div style={{marginTop:compact?6:10}}>
        <div style={{
          display:'grid',
          gridTemplateColumns:`repeat(${Math.max(1,cols)}, ${cellSize}px)`,
          justifyContent:'center',
          alignItems:'center',
          columnGap:compact?7:10,
          rowGap:compact?4:7,
          overflow:'visible',
          padding:compact?'4px 0':'8px 0',
        }}>
          {Array.from({length:totalSlots}).map((_,i)=>{
            const filled = i < dynamicProgressPreview.filled
            const src = filled ? filledUrl : (emptyUrl || filledUrl)
            const stagger8 = !useTwoRows && totalSlots === 8
            return <span key={i} style={{
              width:cellSize,
              height:cellSize,
              display:'inline-flex',
              alignItems:'center',
              justifyContent:'center',
              borderRadius:'50%',
              border:src?'none':'1px solid rgba(255,255,255,.48)',
              background:src?'transparent':(filled?'rgba(255,255,255,.94)':'rgba(255,255,255,.12)'),
              color:filled?(form.primary_color||'#0d9488'):'rgba(255,255,255,.6)',
              fontSize:compact?18:24,
              fontWeight:900,
              opacity:(!filled&&src&&!emptyUrl)?.32:1,
              transform:stagger8 ? `translateY(${i%2===0?-5:5}px)` : 'none',
            }}>
              {src ? <img src={src} alt="" style={{width:'100%',height:'100%',objectFit:'contain'}}/> : (filled ? fallbackFilled : '○')}
            </span>
          })}
        </div>
        {!compact && <div style={{textAlign:'center',fontSize:11,fontWeight:800,color:'rgba(255,255,255,.92)',marginTop:7}}>{dynamicProgressPreview.label}</div>}
      </div>
    )
  }

'''

frontend_pattern = re.compile(
    r'  const renderDynamicProgressPreview = \(compact = false\) => \{[\s\S]*?(?=  const walletPreset =)',
    re.MULTILINE
)

frontend_new, count = frontend_pattern.subn(new_preview_func, frontend, count=1)
if count != 1:
    print("ERROR: Could not locate renderDynamicProgressPreview() in LoyaltyCardCustomizer.")
    print("Backend was patched; restore main.py from main.py.bak if needed.")
    sys.exit(1)

jsx_path.write_text(frontend_new, encoding="utf-8")
print("Patched frontend.")

print()
print("DONE.")
print("Next steps:")
print("1. Upload your tightly-cropped filled PNG and empty PNG.")
print("2. Run the app and inspect Dynamic Banner Preview.")
print("3. Deploy backend + frontend.")
print("4. Save/Publish the card again.")
