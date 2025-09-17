#!/usr/bin/env python3
"""
Create single-layer color Blinka font using individual colored glyphs
Avoid COLR multi-layer alignment issues by making each pixel a separate glyph
"""

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont
from fontTools.colorLib.builder import buildCOLR, buildCPAL
from PIL import Image
import os

def create_single_layer_color_blinka():
    """Create single-layer color Blinka with individual pixel glyphs"""

    print("Creating single-layer color Blinka font from BMP...")
    print("Each pixel becomes its own glyph to avoid COLR alignment issues")

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

    # Collect ALL pixels and their colors
    all_pixels = []
    unique_colors = set()

    for y in range(original_height):
        for x in range(original_width):
            pixel = img.getpixel((x, y))
            rgb = pixel[:3]
            if rgb != bg_color:  # Skip black background
                all_pixels.append((x, y, rgb))
                unique_colors.add(rgb)

    print(f"Found {len(all_pixels)} visible pixels with {len(unique_colors)} unique colors")

    # For testing, use just the top 3 most common colors to keep it manageable
    color_counts = {}
    for x, y, rgb in all_pixels:
        color_counts[rgb] = color_counts.get(rgb, 0) + 1

    # Get the 3 most common colors (same as working 3-color approach)
    sorted_colors = sorted(color_counts.items(), key=lambda x: x[1], reverse=True)
    top_colors = [color for color, count in sorted_colors[:3]]

    print(f"\nUsing top 3 colors:")
    for i, (color, count) in enumerate(sorted_colors[:3]):
        print(f"  {i+1}. RGB{color}: {count} pixels")

    # Group pixels by color
    color_pixels = {}
    for color in top_colors:
        color_pixels[color] = []

    # Assign each pixel to one of the top 3 colors
    for x, y, rgb in all_pixels:
        if rgb in top_colors:
            color_pixels[rgb].append((x, y))
        else:
            # Assign to most common color (like the working 3-color approach)
            largest_color = max(top_colors, key=lambda c: len(color_pixels[c]))
            color_pixels[largest_color].append((x, y))

    # Scale factor
    scale_factor = 4

    # Create base font
    fb = FontBuilder(1000, isTTF=True)

    # Build glyph order - each pixel gets its own glyph
    glyph_order = [".notdef", "space", "blinka"]
    pixel_glyph_names = []

    for i, color in enumerate(top_colors):
        for j, (x, y) in enumerate(color_pixels[color]):
            glyph_name = f"pixel_{i}_{j}"
            glyph_order.append(glyph_name)
            pixel_glyph_names.append((glyph_name, x, y, color))

    fb.setupGlyphOrder(glyph_order)

    def create_single_pixel_glyph(x, y, color_name):
        """Create a glyph for a single pixel at specific coordinates"""
        pen = TTGlyphPen(None)

        # EXACT same coordinate calculation as working versions
        flipped_y = (original_height - 1 - y)
        left = x * scale_factor + 50
        right = left + scale_factor
        bottom = flipped_y * scale_factor + 100
        top = bottom + scale_factor

        # Add rectangle for this single pixel
        pen.moveTo((left, bottom))
        pen.lineTo((right, bottom))
        pen.lineTo((right, top))
        pen.lineTo((left, top))
        pen.closePath()

        return pen.glyph()

    def create_base_outline_glyph():
        """Create base outline from all visible pixels"""
        pen = TTGlyphPen(None)

        all_visible = []
        for color in top_colors:
            all_visible.extend([(x, y) for x, y in color_pixels[color]])

        if not all_visible:
            # Fallback rectangle
            pen.moveTo((50, 100))
            pen.lineTo((50 + original_width * scale_factor, 100))
            pen.lineTo((50 + original_width * scale_factor, 100 + original_height * scale_factor))
            pen.lineTo((50, 100 + original_height * scale_factor))
            pen.closePath()
            return pen.glyph()

        # Find actual bounds (with Y-flip)
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

    # Setup glyphs
    glyphs = {
        ".notdef": create_notdef_glyph(),
        "space": create_space_glyph(),
        "blinka": create_base_outline_glyph()
    }

    # Add individual pixel glyphs
    print(f"\nCreating {len(pixel_glyph_names)} individual pixel glyphs...")
    for glyph_name, x, y, color in pixel_glyph_names:
        glyphs[glyph_name] = create_single_pixel_glyph(x, y, f"RGB{color}")

    fb.setupGlyf(glyphs)

    # Character mapping
    cmap = {
        0x20: "space",
        0xE000: "blinka"
    }
    fb.setupCharacterMap(cmap)

    # Calculate proper metrics
    all_visible = []
    for color in top_colors:
        all_visible.extend([(x, y) for x, y in color_pixels[color]])

    if all_visible:
        min_x = min(x for x, y in all_visible)
        max_x = max(x for x, y in all_visible)
        glyph_width = (max_x - min_x + 2) * scale_factor + 100
    else:
        glyph_width = original_width * scale_factor + 100

    # Metrics for all glyphs
    metrics = {
        ".notdef": (500, 50),
        "space": (600, 0),
        "blinka": (glyph_width, 50)
    }

    # Add metrics for pixel glyphs
    for glyph_name, x, y, color in pixel_glyph_names:
        metrics[glyph_name] = (glyph_width, 50)

    fb.setupHorizontalMetrics(metrics)
    fb.setupHorizontalHeader()

    # Font info
    fb.setupNameTable({
        "familyName": "FreeMono Single Layer Color Blinka",
        "styleName": "Regular",
        "uniqueFontIdentifier": "FreeMonoSingleLayerColorBlinka-1.0",
        "fullName": "FreeMono Single Layer Color Blinka Regular",
        "psName": "FreeMonoSingleLayerColorBlinka-Regular",
        "version": "1.0"
    })

    fb.setupOS2()
    fb.setupPost()

    # Create the font
    font = fb.font

    # Add COLR/CPAL tables - each pixel glyph gets its own color
    try:
        # Create color palette
        palette = []
        for color in top_colors:
            r, g, b = color
            palette.append((r/255.0, g/255.0, b/255.0, 1.0))

        # COLR data - blinka uses ALL the individual pixel glyphs
        layer_list = []
        for i, (glyph_name, x, y, color) in enumerate(pixel_glyph_names):
            # Find which color index this pixel should use
            color_index = top_colors.index(color) if color in top_colors else 0
            layer_list.append((glyph_name, color_index))

        colr_data = {
            "blinka": layer_list
        }

        # Build COLR and CPAL tables
        colr_table = buildCOLR(colr_data)
        cpal_table = buildCPAL([palette])

        # Add to font
        font["COLR"] = colr_table
        font["CPAL"] = cpal_table

        print(f"\nAdded COLR/CPAL with {len(top_colors)} colors and {len(layer_list)} pixel layers:")
        for i, color in enumerate(top_colors):
            pixel_count = len(color_pixels[color])
            print(f"  Palette[{i}]: RGB{color} ({pixel_count} pixels)")

        success = True

    except Exception as e:
        print(f"Could not add COLR/CPAL tables: {e}")
        success = False

    # Save the font
    output_path = "FreeMono-SingleLayerColor-Blinka.ttf"
    font.save(output_path)

    print(f"\nSingle-layer color Blinka font created: {output_path}")
    print(f"Blinka character: \\uE000")

    if success:
        print("* Single-layer COLR implementation with individual pixel glyphs")
        print("* Should eliminate multi-layer alignment issues")
        print("* Each pixel rendered independently with its own color")
    else:
        print("* Created outline-only version")

    return True

if __name__ == "__main__":
    create_single_layer_color_blinka()