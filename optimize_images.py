import os
from PIL import Image
import sys

def optimize_images(directory, max_width=1200):
    """
    Scans a directory for images, converts them to WebP, and resizes them if they are too large.
    """
    if not os.path.exists(directory):
        print(f"Directory not found: {directory}")
        return

    print(f"Scanning directory: {directory}")
    
    # Supported input formats
    extensions = {'.png', '.jpg', '.jpeg', '.bmp', '.tiff'}
    
    for root, _, files in os.walk(directory):
        for file in files:
            file_path = os.path.join(root, file)
            filename, ext = os.path.splitext(file)
            
            if ext.lower() in extensions:
                try:
                    with Image.open(file_path) as img:
                        # Convert to RGB if necessary (e.g. for PNGs with transparency to avoid issues if saving as JPG, not needed for WebP but good practice)
                        if img.mode in ("RGBA", "P"):
                            img = img.convert("RGBA")
                        else:
                            img = img.convert("RGB")
                        
                        # Resize if too large
                        if img.width > max_width:
                            print(f"Resizing {file} (Width: {img.width}px -> {max_width}px)...")
                            aspect_ratio = img.height / img.width
                            new_height = int(max_width * aspect_ratio)
                            img = img.resize((max_width, new_height), Image.Resampling.LANCZOS)
                        
                        # Save as WebP
                        webp_path = os.path.join(root, filename + '.webp')
                        print(f"Converting {file} to {filename}.webp...")
                        img.save(webp_path, 'WEBP', quality=85)
                        
                        print(f"Saved: {webp_path}")

                except Exception as e:
                    print(f"Failed to process {file}: {e}")

if __name__ == "__main__":
    # Check if Pillow is installed
    try:
        import PIL
    except ImportError:
        print("Error: Pillow library is not installed.")
        print("Please install it using: pip install Pillow")
        sys.exit(1)

    base_dir = os.path.dirname(os.path.abspath(__file__))
    images_dir = os.path.join(base_dir, 'images')
    
    # Also check freelance_work for any images if needed, but primarily images folder
    # freelance_dir = os.path.join(base_dir, 'freelance_work')

    optimize_images(images_dir)
    print("Optimization complete!")
