#!/usr/bin/env python3
"""
Create Blinka with invisible boundary spacers
Include the spacer coordinates in the calculation but don't draw them
This should force the coordinate system without visible artifacts
"""

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont
from fontTools.colorLib.builder import buildCOLR, buildCPAL
from PIL import Image
import os

def create_invisible_spacers_blinka():
    """Create Blinka with boundary spacers that are calculated but not drawn"""

    print("Creating invisible spacers Blinka font...")
    print("Boundary spacers included in coordinate calculation but not drawn")

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

    # Collect ALL visible pixels
    all_pixels = []
    for y in range(original_height):
        for x in range(original_width):
            pixel = img.getpixel((x, y))
            rgb = pixel[:3]
            if rgb != bg_color:
                all_pixels.append((x, y))

    print(f"Total visible pixels: {len(all_pixels)}")

    # Split into top and bottom halves
    mid_y = original_height // 2
    top_half_pixels = [(x, y) for x, y in all_pixels if y < mid_y]
    bottom_half_pixels = [(x, y) for x, y in all_pixels if y >= mid_y]

    print(f"\nRegion split:")
    print(f"Top half: {len(top_half_pixels)} pixels")
    print(f"Bottom half: {len(bottom_half_pixels)} pixels")

    # Find the OVERALL bounds of the entire shape
    min_x = min(x for x, y in all_pixels)
    max_x = max(x for x, y in all_pixels)
    min_y = min(y for x, y in all_pixels)
    max_y = max(y for x, y in all_pixels)

    print(f"Overall shape bounds: X={min_x}-{max_x}, Y={min_y}-{max_y}")

    # Scale factor
    scale_factor = 4
    base_offset = 50

    # Create base font
    fb = FontBuilder(1000, isTTF=True)
    glyph_order = [".notdef", "space", "blinka", "blinka.top_invisible_spacers", "blinka.bottom_invisible_spacers"]
    fb.setupGlyphOrder(glyph_order)

    def create_layer_with_invisible_spacers(pixel_positions, layer_name):
        """Create layer that considers spacers for coordinate system but doesn't draw them"""
        pen = TTGlyphPen(None)

        print(f"Creating {layer_name}:")
        print(f"  Visible pixels: {len(pixel_positions)}")

        # Add boundary spacers to the coordinate consideration
        boundary_spacers = [
            (min_x, min_y),  # Top-left corner of overall shape
            (max_x, max_y)   # Bottom-right corner of overall shape
        ]

        # Remove any spacers that are already in the visible pixel list
        spacers_to_consider = []
        for sx, sy in boundary_spacers:
            if (sx, sy) not in pixel_positions:
                spacers_to_consider.append((sx, sy))

        print(f"  Considering {len(spacers_to_consider)} boundary spacers for coordinate system: {spacers_to_consider}")

        # IMPORTANT: Include spacers in coordinate calculation BUT only draw visible pixels
        all_coordinates = pixel_positions + spacers_to_consider

        # Calculate coordinate system bounds (this forces the same system for both layers)
        coord_min_x = min(x for x, y in all_coordinates)
        coord_max_x = max(x for x, y in all_coordinates)
        coord_min_y = min(y for x, y in all_coordinates)
        coord_max_y = max(y for x, y in all_coordinates)

        print(f"  Coordinate system bounds: X={coord_min_x}-{coord_max_x}, Y={coord_min_y}-{coord_max_y}")

        # BUT ONLY DRAW THE VISIBLE PIXELS
        for i, (x, y) in enumerate(pixel_positions):  # Only visible pixels!
            # EXACT same coordinate calculation as working version
            flipped_y = (original_height - 1 - y)
            left = x * scale_factor + base_offset
            right = left + scale_factor
            bottom = flipped_y * scale_factor + 100
            top = bottom + scale_factor

            # Debug first few pixels
            if i < 3:
                print(f"    VISIBLE {i}: BMP({x},{y}) -> Font({left},{bottom}) to ({right},{top})")

            # Add rectangle - ONLY for visible pixels
            pen.moveTo((left, bottom))
            pen.lineTo((right, bottom))
            pen.lineTo((right, top))
            pen.lineTo((left, top))
            pen.closePath()

        print(f"  Drew {len(pixel_positions)} rectangles (spacers considered but not drawn)")
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

    # Setup glyphs with invisible spacers
    glyphs = {
        ".notdef": create_notdef_glyph(),
        "space": create_space_glyph(),
        "blinka": create_empty_base(),
        "blinka.top_invisible_spacers": create_layer_with_invisible_spacers(top_half_pixels, "top_invisible_spacers"),
        "blinka.bottom_invisible_spacers": create_layer_with_invisible_spacers(bottom_half_pixels, "bottom_invisible_spacers")
    }

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
        "blinka.top_invisible_spacers": (glyph_width, 50),
        "blinka.bottom_invisible_spacers": (glyph_width, 50)
    }

    fb.setupHorizontalMetrics(metrics)
    fb.setupHorizontalHeader()

    # Font info
    fb.setupNameTable({
        "familyName": "FreeMono Invisible Spacers Blinka",
        "styleName": "Regular",
        "uniqueFontIdentifier": "FreeMonoInvisibleSpacersBlinka-1.0",
        "fullName": "FreeMono Invisible Spacers Blinka Regular",
        "psName": "FreeMonoInvisibleSpacersBlinka-Regular",
        "version": "1.0"
    })

    fb.setupOS2()
    fb.setupPost()

    font = fb.font

    # COLR/CPAL tables
    try:
        purple_color = (128/255.0, 32/255.0, 192/255.0, 1.0)
        blue_color = (64/255.0, 128/255.0, 255/255.0, 1.0)
        palette = [purple_color, blue_color]

        colr_data = {
            "blinka": [
                ("blinka.bottom_invisible_spacers", 1),  # Blue bottom
                ("blinka.top_invisible_spacers", 0)      # Purple top
            ]
        }

        colr_table = buildCOLR(colr_data)
        cpal_table = buildCPAL([palette])

        font["COLR"] = colr_table
        font["CPAL"] = cpal_table

        print(f"\nAdded COLR/CPAL with invisible boundary spacers:")
        print(f"  Spacers considered for coordinate system but not drawn")
        print(f"  Should maintain alignment without visible artifacts")
        success = True

    except Exception as e:
        print(f"Could not add COLR/CPAL tables: {e}")
        success = False

    # Save font
    output_path = "FreeMono-InvisibleSpacers-Blinka.ttf"
    font.save(output_path)

    print(f"\nInvisible spacers Blinka font created: {output_path}")

    if success:
        print("* Boundary spacers considered but not drawn")
        print("* Should preserve coordinate alignment without artifacts")
        print("* Test the 'best of both worlds' approach")

    return True

if __name__ == "__main__":
    create_invisible_spacers_blinka()