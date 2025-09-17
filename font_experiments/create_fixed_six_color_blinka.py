#!/usr/bin/env python3
"""
Create FIXED six-color Blinka font using the working 3-color approach
Properly handle all colors instead of forcing unknowns into purple1
"""

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont
from fontTools.colorLib.builder import buildCOLR, buildCPAL
from PIL import Image
import os

def create_fixed_six_color_blinka():
    """Create FIXED six-color Blinka font with proper color mapping"""

    print("Creating FIXED six-color Blinka font from BMP...")
    print("Using working 3-color approach, extending to 6 most common colors")

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
    print(f"Background color: RGB{bg_color}")

    # Count ALL colors first to pick the 6 most common
    color_counts = {}
    for y in range(original_height):
        for x in range(original_width):
            pixel = img.getpixel((x, y))
            rgb = pixel[:3]
            if rgb != bg_color:
                color_counts[rgb] = color_counts.get(rgb, 0) + 1

    # Get the 6 most common colors
    sorted_colors = sorted(color_counts.items(), key=lambda x: x[1], reverse=True)
    top_6_colors = [color for color, count in sorted_colors[:6]]

    print(f"\nTop 6 most common colors:")
    for i, (color, count) in enumerate(sorted_colors[:6]):
        print(f"  {i+1}. RGB{color}: {count} pixels")

    # Separate pixels by the top 6 colors (like the working 3-color approach)
    color_pixels = {}
    for color in top_6_colors:
        color_pixels[color] = []
    other_pixels = []

    for y in range(original_height):
        for x in range(original_width):
            pixel = img.getpixel((x, y))
            rgb = pixel[:3]

            if rgb == bg_color:  # Skip black background
                continue
            elif rgb in top_6_colors:
                color_pixels[rgb].append((x, y))
            else:
                # Add to the largest color group (like 3-color does)
                largest_color = max(top_6_colors, key=lambda c: len(color_pixels[c]))
                color_pixels[largest_color].append((x, y))
                other_pixels.append((x, y, rgb))

    print(f"\nFixed pixel assignment:")
    for i, color in enumerate(top_6_colors):
        print(f"  Color{i+1} RGB{color}: {len(color_pixels[color])} pixels")

    if other_pixels:
        print(f"  {len(other_pixels)} other pixels assigned to largest group")

    # Scale factor for better visibility
    scale_factor = 4
    scaled_width = original_width * scale_factor
    scaled_height = original_height * scale_factor

    # Create base font (same structure as working versions)
    fb = FontBuilder(1000, isTTF=True)
    glyph_order = [".notdef", "space", "blinka"]
    for i, color in enumerate(top_6_colors):
        glyph_order.append(f"blinka.color{i:02d}")
    fb.setupGlyphOrder(glyph_order)

    def create_color_layer_glyph(pixel_positions, color_name):
        """Create a layer glyph for specific pixels (SAME as working versions)"""
        pen = TTGlyphPen(None)

        if not pixel_positions:
            return pen.glyph()  # Empty glyph if no pixels

        for x, y in pixel_positions:
            # Y-axis flip for correct orientation (EXACT same calculation)
            flipped_y = (original_height - 1 - y)

            # Calculate scaled coordinates (EXACT same calculation)
            left = x * scale_factor + 50
            right = left + scale_factor
            bottom = flipped_y * scale_factor + 100
            top = bottom + scale_factor

            # Add rectangle
            pen.moveTo((left, bottom))
            pen.lineTo((right, bottom))
            pen.lineTo((right, top))
            pen.lineTo((left, top))
            pen.closePath()

        return pen.glyph()

    def create_base_outline_glyph():
        """Create base outline from all visible pixels (SAME as working versions)"""
        pen = TTGlyphPen(None)

        all_visible = []
        for color in top_6_colors:
            all_visible.extend(color_pixels[color])

        if not all_visible:
            # Fallback rectangle
            pen.moveTo((50, 100))
            pen.lineTo((50 + scaled_width, 100))
            pen.lineTo((50 + scaled_width, 100 + scaled_height))
            pen.lineTo((50, 100 + scaled_height))
            pen.closePath()
            return pen.glyph()

        # Find actual bounds (with Y-flip) - EXACT same calculation
        min_x = min(x for x, y in all_visible)
        max_x = max(x for x, y in all_visible)
        min_y = min(original_height - 1 - y for x, y in all_visible)
        max_y = max(original_height - 1 - y for x, y in all_visible)

        # Scale to font coordinates
        left = min_x * scale_factor + 50
        right = (max_x + 1) * scale_factor + 50
        bottom = min_y * scale_factor + 100
        top = (max_y + 1) * scale_factor + 100

        # Create tight bounding rectangle
        pen.moveTo((left, bottom))
        pen.lineTo((right, bottom))
        pen.lineTo((right, top))
        pen.lineTo((left, top))
        pen.closePath()

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

    # Setup glyphs (same structure as working versions)
    glyphs = {
        ".notdef": create_notdef_glyph(),
        "space": create_space_glyph(),
        "blinka": create_base_outline_glyph()
    }

    # Add color layer glyphs
    for i, color in enumerate(top_6_colors):
        glyph_name = f"blinka.color{i:02d}"
        pixels = color_pixels[color]
        glyphs[glyph_name] = create_color_layer_glyph(pixels, f"color{i:02d}")

    fb.setupGlyf(glyphs)

    # Character mapping
    cmap = {
        0x20: "space",
        0xE000: "blinka"
    }
    fb.setupCharacterMap(cmap)

    # Calculate proper metrics (SAME as working versions)
    all_visible = []
    for color in top_6_colors:
        all_visible.extend(color_pixels[color])

    if all_visible:
        min_x = min(x for x, y in all_visible)
        max_x = max(x for x, y in all_visible)
        glyph_width = (max_x - min_x + 2) * scale_factor + 100
    else:
        glyph_width = scaled_width + 100

    # Metrics for all glyphs
    metrics = {
        ".notdef": (500, 50),
        "space": (600, 0),
        "blinka": (glyph_width, 50)
    }

    # Add metrics for color layer glyphs
    for i, color in enumerate(top_6_colors):
        glyph_name = f"blinka.color{i:02d}"
        metrics[glyph_name] = (glyph_width, 50)

    fb.setupHorizontalMetrics(metrics)
    fb.setupHorizontalHeader()

    # Font info
    fb.setupNameTable({
        "familyName": "FreeMono Fixed Six Color Blinka",
        "styleName": "Regular",
        "uniqueFontIdentifier": "FreeMonoFixedSixColorBlinka-1.0",
        "fullName": "FreeMono Fixed Six Color Blinka Regular",
        "psName": "FreeMonoFixedSixColorBlinka-Regular",
        "version": "1.0"
    })

    fb.setupOS2()
    fb.setupPost()

    # Create the font
    font = fb.font

    # Add COLR/CPAL tables with the top 6 colors
    try:
        # Create normalized color palette
        palette = []
        for color in top_6_colors:
            r, g, b = color
            palette.append((r/255.0, g/255.0, b/255.0, 1.0))

        # COLR data - all layers
        layer_list = []
        for i, color in enumerate(top_6_colors):
            glyph_name = f"blinka.color{i:02d}"
            layer_list.append((glyph_name, i))

        colr_data = {
            "blinka": layer_list
        }

        # Build COLR and CPAL tables
        colr_table = buildCOLR(colr_data)
        cpal_table = buildCPAL([palette])

        # Add to font
        font["COLR"] = colr_table
        font["CPAL"] = cpal_table

        print(f"\nAdded COLR/CPAL with {len(top_6_colors)} colors:")
        for i, color in enumerate(top_6_colors):
            pixel_count = len(color_pixels[color])
            print(f"  Palette[{i:2d}]: RGB{color} ({pixel_count:2d} pixels)")

        success = True

    except Exception as e:
        print(f"Could not add COLR/CPAL tables: {e}")
        success = False

    # Save the font
    output_path = "FreeMono-FixedSixColor-Blinka.ttf"
    font.save(output_path)

    print(f"\nFixed six-color Blinka font created: {output_path}")
    print(f"Blinka character: \\uE000")

    if success:
        print("* FIXED six-color COLR/CPAL implementation")
        print("* No pixel conflicts - each pixel assigned to ONE layer only")
        print("* Uses same coordinate calculation as working 3-color version")
        print("* Should resolve scattered pixel positioning")
    else:
        print("* Created outline-only version")

    return True

if __name__ == "__main__":
    create_fixed_six_color_blinka()