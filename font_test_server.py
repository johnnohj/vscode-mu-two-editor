#!/usr/bin/env python3
"""
Simple HTTP server for testing the color Blinka font
Serves files with proper MIME types for font loading
"""

import http.server
import socketserver
import webbrowser
import os
import sys
from pathlib import Path

class FontTestHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    """Custom handler with proper MIME types for fonts"""

    def end_headers(self):
        # Add CORS headers for font loading
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        super().end_headers()

    def guess_type(self, path):
        """Override to add font MIME types"""
        # Add font-specific MIME types first
        if path.endswith('.ttf'):
            return 'font/ttf'
        elif path.endswith('.otf'):
            return 'font/otf'
        elif path.endswith('.woff'):
            return 'font/woff'
        elif path.endswith('.woff2'):
            return 'font/woff2'
        elif path.endswith('.bmp'):
            return 'image/bmp'

        # Fall back to parent implementation
        return super().guess_type(path)

def start_server(port=8000):
    """Start the HTTP server"""

    # Change to the directory containing our files
    os.chdir(Path(__file__).parent)

    # Check if required files exist
    required_files = [
        'FreeMono-Color-Blinka.ttf',
        'test_color_blinka_font.html',
        'assets/blinka.bmp'
    ]

    missing_files = []
    for file in required_files:
        if not os.path.exists(file):
            missing_files.append(file)

    if missing_files:
        print("Missing required files:")
        for file in missing_files:
            print(f"  - {file}")
        print("\nPlease ensure all files are present before starting the server.")
        return False

    # Try to find an available port
    for attempt_port in range(port, port + 10):
        try:
            with socketserver.TCPServer(("", attempt_port), FontTestHTTPRequestHandler) as httpd:
                print(f"Starting font test server...")
                print(f"Server running at: http://localhost:{attempt_port}")
                print(f"Test page: http://localhost:{attempt_port}/test_color_blinka_font.html")
                print(f"Font file: http://localhost:{attempt_port}/FreeMono-Color-Blinka.ttf")
                print("\nPress Ctrl+C to stop the server")

                # Try to open the test page in the default browser
                try:
                    webbrowser.open(f'http://localhost:{attempt_port}/test_color_blinka_font.html')
                    print("Opening test page in default browser...")
                except Exception as e:
                    print(f"Could not open browser automatically: {e}")
                    print("Please manually navigate to the test page URL above")

                # Start serving
                httpd.serve_forever()

        except OSError as e:
            if e.errno == 98:  # Address already in use
                print(f"Port {attempt_port} is already in use, trying {attempt_port + 1}...")
                continue
            else:
                print(f"Error starting server on port {attempt_port}: {e}")
                return False

    print(f"Could not find an available port in range {port}-{port + 9}")
    return False

def list_directory_contents():
    """List current directory contents for debugging"""
    print("Current directory contents:")
    for item in sorted(os.listdir('.')):
        if os.path.isfile(item):
            size = os.path.getsize(item)
            print(f"  FILE: {item} ({size:,} bytes)")
        else:
            print(f"  DIR:  {item}/")

if __name__ == "__main__":
    print("=" * 50)
    print("Color Blinka Font Test Server")
    print("=" * 50)

    # List directory contents for reference
    list_directory_contents()
    print()

    try:
        # Start the server
        start_server()
    except KeyboardInterrupt:
        print("\n\nServer stopped by user")
    except Exception as e:
        print(f"\nServer error: {e}")
        sys.exit(1)