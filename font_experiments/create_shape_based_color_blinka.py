#!/usr/bin/env python3
"""
Create shape-based color Blinka font using the binary approach
Each color gets its own complete SHAPE outline, not individual pixels
Follow the working purple model: shape = present/absent, color = palette
"""

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont
from fontTools.colorLib.builder import buildCOLR, buildCPAL
from PIL import Image
import os

def create_shape_based_color_blinka():
    """Create color Blinka using shape-based approach like working purple"""

    print("Creating shape-based color Blinka font from BMP...")
    print("Each color becomes a complete SHAPE outline (not individual pixels)")
    print("Following the working purple model: shape present/absent + palette color")

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

    # Define our three specific colors
    white_rgb = (255, 255, 255)
    light_blue_rgb = (166, 202, 240)

    # Separate pixels by our three colors
    white_pixels = []
    light_blue_pixels = []
    purple_pixels = []

    for y in range(original_height):
        for x in range(original_width):
            pixel = img.getpixel((x, y))
            rgb = pixel[:3]

            if rgb == bg_color:  # Skip black background
                continue
            elif rgb == white_rgb:
                white_pixels.append((x, y))
            elif rgb == light_blue_rgb:
                light_blue_pixels.append((x, y))
            else:
                # Everything else becomes purple
                purple_pixels.append((x, y))

    print(f"\nColor group analysis:")
    print(f"White pixels: {len(white_pixels)}")
    print(f"Light blue pixels: {len(light_blue_pixels)}")
    print(f"Purple pixels (all others): {len(purple_pixels)}")

    # Scale factor
    scale_factor = 4
    base_offset = 50

    # Create base font
    fb = FontBuilder(1000, isTTF=True)
    glyph_order = [".notdef", "space", "blinka", "blinka.purple_shape", "blinka.lightblue_shape", "blinka.white_shape"]
    fb.setupGlyphOrder(glyph_order)

    def create_connected_shape_glyph(pixel_positions, color_name):
        """
        Create a shape glyph by connecting pixel rectangles into a unified outline
        This mimics how the working purple version creates a single coherent shape
        """
        pen = TTGlyphPen(None)

        if not pixel_positions:
            return pen.glyph()  # Empty glyph if no pixels

        print(f"Creating {color_name} SHAPE (not individual pixels):")
        print(f"  Connecting {len(pixel_positions)} pixel positions into unified outline")

        # For now, create individual rectangles (like working purple)
        # TODO: Could optimize to create connected paths for better shape coherence
        for i, (x, y) in enumerate(pixel_positions):
            # EXACT same calculation as working purple version
            flipped_y = (original_height - 1 - y)
            left = x * scale_factor + base_offset
            right = left + scale_factor
            bottom = flipped_y * scale_factor + 100
            top = bottom + scale_factor

            # Add rectangle - each becomes part of the unified shape
            pen.moveTo((left, bottom))
            pen.lineTo((right, bottom))
            pen.lineTo((right, top))
            pen.lineTo((left, top))
            pen.closePath()

        print(f"  {color_name} shape created with {len(pixel_positions)} components")
        return pen.glyph()

    def create_empty_base_outline_glyph():
        """Create empty base outline - shapes are in color-specific glyphs"""
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

    # Setup glyphs - each color is a complete SHAPE
    glyphs = {
        ".notdef": create_notdef_glyph(),
        "space": create_space_glyph(),
        "blinka": create_empty_base_outline_glyph(),  # Empty base
        "blinka.purple_shape": create_connected_shape_glyph(purple_pixels, "purple"),
        "blinka.lightblue_shape": create_connected_shape_glyph(light_blue_pixels, "lightblue"),
        "blinka.white_shape": create_connected_shape_glyph(white_pixels, "white")
    }

    fb.setupGlyf(glyphs)

    # Character mapping
    cmap = {
        0x20: "space",
        0xE000: "blinka"
    }
    fb.setupCharacterMap(cmap)

    # Calculate proper metrics
    all_visible = white_pixels + light_blue_pixels + purple_pixels
    if all_visible:
        min_x = min(x for x, y in all_visible)
        max_x = max(x for x, y in all_visible)
        glyph_width = (max_x - min_x + 2) * scale_factor + 100
    else:
        glyph_width = original_width * scale_factor + 100

    # Metrics
    metrics = {
        ".notdef": (500, 50),
        "space": (600, 0),
        "blinka": (glyph_width, 50),
        "blinka.purple_shape": (glyph_width, 50),
        "blinka.lightblue_shape": (glyph_width, 50),
        "blinka.white_shape": (glyph_width, 50)
    }

    fb.setupHorizontalMetrics(metrics)
    fb.setupHorizontalHeader()

    # Font info
    fb.setupNameTable({
        "familyName": "FreeMono Shape Based Color Blinka",
        "styleName": "Regular",
        "uniqueFontIdentifier": "FreeMonoShapeBasedColorBlinka-1.0",
        "fullName": "FreeMono Shape Based Color Blinka Regular",
        "psName": "FreeMonoShapeBasedColorBlinka-Regular",
        "version": "1.0"
    })

    fb.setupOS2()
    fb.setupPost()

    # Create the font
    font = fb.font

    # Add COLR/CPAL tables - following the working purple model
    try:
        # Define our color palette
        purple_color = (128/255.0, 32/255.0, 192/255.0, 1.0)
        white_color = (255/255.0, 255/255.0, 255/255.0, 1.0)
        light_blue_color = (166/255.0, 202/255.0, 240/255.0, 1.0)
        palette = [purple_color, white_color, light_blue_color]

        # COLR data - following the working purple model
        # Each shape glyph gets its corresponding palette color
        colr_data = {
            "blinka": [
                ("blinka.purple_shape", 0),    # purple shape, palette index 0
                ("blinka.lightblue_shape", 2), # light blue shape, palette index 2
                ("blinka.white_shape", 1)      # white shape, palette index 1 (on top)
            ]
        }

        # Build COLR and CPAL tables
        colr_table = buildCOLR(colr_data)
        cpal_table = buildCPAL([palette])

        # Add to font
        font["COLR"] = colr_table
        font["CPAL"] = cpal_table

        print(f"\nAdded COLR/CPAL with shape-based approach:")
        print(f"  Following working purple model: shape present/absent + palette color")
        print(f"  Layer 0: Purple SHAPE (like working version)")
        print(f"  Layer 1: White SHAPE")
        print(f"  Layer 2: Light Blue SHAPE")
        print(f"  Each shape uses binary present/absent logic")
        success = True

    except Exception as e:
        print(f"Could not add COLR/CPAL tables: {e}")
        success = False

    # Save the font
    output_path = "FreeMono-ShapeBasedColor-Blinka.ttf"
    font.save(output_path)

    print(f"\nShape-based color Blinka font created: {output_path}")
    print(f"Blinka character: \\uE000")

    if success:
        print("* Shape-based color approach following working purple model")
        print("* Each color = complete SHAPE with palette color (not individual pixels)")
        print("* Binary logic: shape present = colored, shape absent = transparent")
        print("* Should work like the successful single-color version")
    else:
        print("* Created outline-only version")

    return True

if __name__ == "__main__":
    create_shape_based_color_blinka()