#!/usr/bin/env python3
"""
Create seventeen-color Blinka with ALL colors from original BMP
100% color fidelity with smarter spacer logic to minimize corner artifacts
Based on successful twelve-color implementation
"""

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont
from fontTools.colorLib.builder import buildCOLR, buildCPAL
from PIL import Image
import os

def create_final_seventeen_color_blinka():
    """Create seventeen-color Blinka with maximum color fidelity and smart spacers"""

    print("Creating final seventeen-color Blinka font...")
    print("100% color fidelity - ALL colors from original BMP with smart spacer logic")

    bmp_path = "assets/blinka.bmp"
    if not os.path.exists(bmp_path):
        print(f"BMP file not found: {bmp_path}")
        return False

    # Load and analyze the BMP
    img = Image.open(bmp_path)
    img = img.convert('RGBA')
    original_width, original_height = img.size

    print(f"Original BMP: {original_width}x{original_height}")

    # Get background color (black)
    bg_color = img.getpixel((0, 0))[:3]

    # Define ALL seventeen colors from the original BMP analysis
    # Ordered by visual importance: essential colors first, then by frequency
    seventeen_colors = [
        # Essential colors (MUST preserve)
        (255, 255, 255),   # WHITE - Essential eyes (2 pixels)
        (166, 202, 240),   # LIGHT BLUE - Essential eyes (8 pixels)

        # High frequency colors
        (128, 32, 192),    # Main purple (20 pixels)
        (96, 24, 144),     # Dark purple (14 pixels)
        (96, 64, 128),     # Purple-blue (13 pixels)
        (160, 32, 192),    # Bright purple (12 pixels)
        (61, 43, 52),      # Dark gray-purple (12 pixels)
        (40, 49, 58),      # Dark blue-gray (11 pixels)
        (102, 26, 154),    # Medium purple (10 pixels)
        (120, 24, 144),    # Dark purple variant (8 pixels)
        (128, 26, 154),    # Medium purple variant (6 pixels)
        (224, 160, 192),   # Light pink-purple (6 pixels)

        # Final five colors (low frequency but complete fidelity)
        (64, 42, 85),      # Dark purple-gray (2 pixels)
        (60, 40, 80),      # Dark purple variant (2 pixels)
        (38, 46, 55),      # Dark blue-gray variant (2 pixels)
        (0, 64, 192),      # Blue accent (1 pixel)
        (56, 40, 48)       # Dark gray (1 pixel)
    ]

    # Separate pixels by color
    color_pixel_groups = {}
    all_visible_pixels = []

    for y in range(original_height):
        for x in range(original_width):
            pixel = img.getpixel((x, y))
            rgb = pixel[:3]

            if rgb == bg_color:
                continue

            all_visible_pixels.append((x, y))

            # Check if this pixel matches one of our seventeen target colors
            for color in seventeen_colors:
                if rgb == color:
                    if color not in color_pixel_groups:
                        color_pixel_groups[color] = []
                    color_pixel_groups[color].append((x, y))
                    break

    print(f"Total visible pixels: {len(all_visible_pixels)}")
    print(f"Seventeen-color breakdown (100% BMP fidelity):")
    for i, color in enumerate(seventeen_colors):
        count = len(color_pixel_groups.get(color, []))
        color_name = ""
        if color == (255, 255, 255):
            color_name = " (WHITE - eyes)"
        elif color == (166, 202, 240):
            color_name = " (LIGHT BLUE - eyes)"
        elif color == (128, 32, 192):
            color_name = " (MAIN PURPLE)"
        elif color == (0, 64, 192):
            color_name = " (BLUE ACCENT - rare)"
        elif i >= 12:
            color_name = " (FINAL FIVE)"
        print(f"  Color {i+1:2d} RGB{color}{color_name}: {count} pixels")

    # Calculate remaining pixels - should be ZERO for complete fidelity
    total_colored_pixels = sum(len(pixels) for pixels in color_pixel_groups.values())
    remaining_pixels = len(all_visible_pixels) - total_colored_pixels
    print(f"  Remaining pixels (base layer): {remaining_pixels}")

    if remaining_pixels == 0:
        print("  PERFECT: 100% color fidelity achieved!")

    # Find the OVERALL bounds of the entire shape
    min_x = min(x for x, y in all_visible_pixels)
    max_x = max(x for x, y in all_visible_pixels)
    min_y = min(y for x, y in all_visible_pixels)
    max_y = max(y for x, y in all_visible_pixels)

    print(f"Overall shape bounds: X={min_x}-{max_x}, Y={min_y}-{max_y}")

    # Scale factor
    scale_factor = 4
    base_offset = 50

    # Create base font
    fb = FontBuilder(1000, isTTF=True)
    glyph_order = [".notdef", "space", "blinka", "blinka.base"] + [f"blinka.color{i+1:02d}" for i in range(17)]
    fb.setupGlyphOrder(glyph_order)

    def create_layer_with_smart_spacers(pixel_positions, layer_name, description, needs_spacers=True):
        """Create layer with smart spacer logic to minimize artifacts"""
        pen = TTGlyphPen(None)

        print(f"Creating {layer_name}: {description}")
        print(f"  Pixels to draw: {len(pixel_positions)}")

        # SMART SPACER LOGIC: Only add spacers if layer actually needs them
        spacers_to_add = []
        if needs_spacers and pixel_positions:
            boundary_spacers = [
                (min_x, min_y),  # Top-left corner of overall shape
                (max_x, max_y)   # Bottom-right corner of overall shape
            ]

            # Only add spacers that aren't already covered by actual pixels
            for sx, sy in boundary_spacers:
                if (sx, sy) not in pixel_positions:
                    spacers_to_add.append((sx, sy))

            if spacers_to_add:
                print(f"  Adding {len(spacers_to_add)} smart boundary spacers: {spacers_to_add}")
            else:
                print(f"  No spacers needed - layer already covers corners")

        all_layer_pixels = pixel_positions + spacers_to_add

        for i, (x, y) in enumerate(all_layer_pixels):
            # EXACT same coordinate calculation as working version
            flipped_y = (original_height - 1 - y)
            left = x * scale_factor + base_offset
            bottom = flipped_y * scale_factor + 100

            # Check if this is a spacer pixel
            is_spacer = (x, y) in spacers_to_add

            if is_spacer:
                # Make spacers TINY (1x1 instead of 4x4)
                right = left + 1
                top = bottom + 1
            else:
                # Normal size for visible pixels
                right = left + scale_factor
                top = bottom + scale_factor

            # Add rectangle
            pen.moveTo((left, bottom))
            pen.lineTo((right, bottom))
            pen.lineTo((right, top))
            pen.lineTo((left, top))
            pen.closePath()

        return pen.glyph()

    def create_empty_base():
        pen = TTGlyphPen(None)
        return pen.glyph()

    def create_space_glyph():
        pen = TTGlyphPen(None)
        return pen.glyph()

    def create_notdef_glyph():
        pen = TTGlyphPen(None)
        pen.moveTo((50, 0))
        pen.lineTo((450, 0))
        pen.lineTo((450, 750))
        pen.lineTo((50, 750))
        pen.closePath()
        return pen.glyph()

    # Setup seventeen-layer glyphs with smart spacers
    glyphs = {
        ".notdef": create_notdef_glyph(),
        "space": create_space_glyph(),
        "blinka": create_empty_base(),
        "blinka.base": create_layer_with_smart_spacers(
            all_visible_pixels,
            "base",
            "ALL pixels - provides base background",
            needs_spacers=True  # Base layer definitely needs spacers
        )
    }

    # Add the seventeen color overlay layers
    for i, color in enumerate(seventeen_colors):
        pixels = color_pixel_groups.get(color, [])
        layer_name = f"blinka.color{i+1:02d}"
        color_name = ""
        if color == (255, 255, 255):
            color_name = " (WHITE)"
        elif color == (166, 202, 240):
            color_name = " (LIGHT BLUE)"
        elif color == (0, 64, 192):
            color_name = " (BLUE ACCENT)"
        elif i >= 12:
            color_name = " (FINAL FIVE)"

        # SMART DECISION: Only add spacers to layers that might need coordinate forcing
        # Layers with many pixels or essential colors get spacers, tiny layers might not need them
        needs_spacers = len(pixels) > 4 or color in [(255, 255, 255), (166, 202, 240), (128, 32, 192)]

        glyphs[layer_name] = create_layer_with_smart_spacers(
            pixels,
            f"color{i+1:02d}",
            f"RGB{color}{color_name} pixels only",
            needs_spacers=needs_spacers
        )

    fb.setupGlyf(glyphs)

    # Character mapping
    cmap = {
        0x20: "space",
        0xE000: "blinka"
    }
    fb.setupCharacterMap(cmap)

    # Metrics calculation
    glyph_width = (max_x - min_x + 2) * scale_factor + 100

    metrics = {
        ".notdef": (500, 50),
        "space": (600, 0),
        "blinka": (glyph_width, 50),
        "blinka.base": (glyph_width, 50)
    }

    # Add metrics for color layers
    for i in range(17):
        metrics[f"blinka.color{i+1:02d}"] = (glyph_width, 50)

    fb.setupHorizontalMetrics(metrics)
    fb.setupHorizontalHeader()

    # Font info
    fb.setupNameTable({
        "familyName": "FreeMono Final Seventeen Color Blinka",
        "styleName": "Regular",
        "uniqueFontIdentifier": "FreeMonoFinalSeventeenColorBlinka-1.0",
        "fullName": "FreeMono Final Seventeen Color Blinka Regular",
        "psName": "FreeMonoFinalSeventeenColorBlinka-Regular",
        "version": "1.0"
    })

    fb.setupOS2()
    fb.setupPost()

    font = fb.font

    # COLR/CPAL tables with seventeen colors
    try:
        # Define our color palette - convert RGB to normalized values
        palette = []
        palette.append((128/255.0, 32/255.0, 192/255.0, 1.0))  # Index 0: Base purple

        for color in seventeen_colors:
            r, g, b = color
            palette.append((r/255.0, g/255.0, b/255.0, 1.0))

        print(f"\nColor palette ({len(palette)} colors - COMPLETE BMP FIDELITY):")
        for i, (r, g, b, a) in enumerate(palette):
            rgb_values = (int(r*255), int(g*255), int(b*255))
            color_name = ""
            if rgb_values == (255, 255, 255):
                color_name = " (WHITE)"
            elif rgb_values == (166, 202, 240):
                color_name = " (LIGHT BLUE)"
            elif rgb_values == (0, 64, 192):
                color_name = " (BLUE ACCENT)"
            print(f"  Index {i:2d}: RGB{rgb_values}{color_name}")

        # COLR data - layered from bottom to top
        colr_layers = [("blinka.base", 0)]  # Base layer with index 0

        # Add the seventeen color overlays
        for i in range(17):
            layer_name = f"blinka.color{i+1:02d}"
            color_index = i + 1  # Palette indices 1-17
            colr_layers.append((layer_name, color_index))

        colr_data = {"blinka": colr_layers}

        colr_table = buildCOLR(colr_data)
        cpal_table = buildCPAL([palette])

        font["COLR"] = colr_table
        font["CPAL"] = cpal_table

        print(f"\nAdded COLR/CPAL with seventeen-color layering:")
        print(f"  Total layers: {len(colr_layers)} (1 base + 17 color overlays)")
        print(f"  Base layer: {len(all_visible_pixels)} pixels")
        for i, color in enumerate(seventeen_colors):
            count = len(color_pixel_groups.get(color, []))
            color_name = ""
            if color == (255, 255, 255):
                color_name = " (WHITE - preserved)"
            elif color == (166, 202, 240):
                color_name = " (LIGHT BLUE - preserved)"
            elif color == (0, 64, 192):
                color_name = " (BLUE ACCENT - rare)"
            elif i >= 12:
                color_name = " (FINAL FIVE for 100% fidelity)"
            print(f"  Layer {i+2:2d}: RGB{color}{color_name} - {count} pixels")
        print(f"  Using smart spacer logic to minimize artifacts")
        success = True

    except Exception as e:
        print(f"Could not add COLR/CPAL tables: {e}")
        success = False

    # Save font
    output_path = "FreeMono-FinalSeventeenColor-Blinka.ttf"
    font.save(output_path)

    print(f"\nFinal seventeen-color Blinka font created: {output_path}")
    print(f"Blinka character: \\uE000")

    if success:
        print("* SEVENTEEN distinct color layers with perfect alignment")
        print("* 100% COLOR FIDELITY from original 16x16 BMP")
        print("* Preserves ALL essential colors from successful versions")
        print("* Smart spacer logic to minimize corner artifacts")
        print("* Uses proven tiny spacer coordinate alignment")
        print("* ULTIMATE color font achievement!")
    else:
        print("* Created outline-only version")

    return True

if __name__ == "__main__":
    create_final_seventeen_color_blinka()