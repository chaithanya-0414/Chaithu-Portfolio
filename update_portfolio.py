import os
import datetime


# Configuration
FREELANCE_DIR = os.path.join(os.getcwd(), "freelance_work")
INDEX_FILE = os.path.join(os.getcwd(), "index.html")
MARKER_START = "<!-- AUTO-GENERATED-START -->"
MARKER_END = "<!-- AUTO-GENERATED-END -->"

def get_file_icon(filename):
    """Returns a FontAwesome icon class based on file extension."""
    ext = os.path.splitext(filename)[1].lower()
    if ext in ['.ppt', '.pptx']:
        return "fas fa-file-powerpoint"
    elif ext == '.pdf':
        return "fas fa-file-pdf"
    elif ext in ['.doc', '.docx']:
        return "fas fa-file-word"
    elif ext in ['.jpg', '.jpeg', '.png']:
        return "fas fa-file-image"
    else:
        return "fas fa-file-alt"

def generate_html(files):
    """Generates HTML list items for the files."""
    if not files:
        return """
                            <div class="empty-folder-state bg-surface-container-highest p-8 rounded-2xl text-center text-secondary">
                                <p><i class="fas fa-info-circle mb-2 text-2xl"></i><br>No files uploaded yet. Check back soon!</p>
                            </div>"""
    
    html_parts = ['<ul class="file-list flex flex-col gap-4">']
    for filename in files:
        file_path = f"freelance_work/{filename}" # Web path should use forward slashes
        icon = get_file_icon(filename)
        
        # Create a nice download link item
        item_html = f"""
                                <li class="file-item group bg-[#1a1423] hover:bg-[#251d33] border border-[#b066ff]/20 hover:border-[#b066ff]/50 rounded-2xl transition-all duration-300 hover:shadow-[0_0_15px_rgba(176,102,255,0.15)] hover:-translate-y-1">
                                    <a href="{file_path}" target="_blank" class="file-link flex items-center p-5 gap-4">
                                        <div class="w-12 h-12 rounded-xl bg-[#b066ff]/10 flex items-center justify-center shrink-0">
                                            <i class="{icon} file-icon text-[#b066ff] text-xl"></i>
                                        </div>
                                        <span class="file-name flex-1 text-on-background font-bold text-sm md:text-base truncate">{filename}</span>
                                        <div class="w-10 h-10 rounded-full bg-surface-container-highest group-hover:bg-[#b066ff] text-secondary group-hover:text-background flex items-center justify-center transition-colors shrink-0">
                                            <i class="fas fa-download download-icon text-sm"></i>
                                        </div>
                                    </a>
                                </li>"""
        html_parts.append(item_html)
    
    html_parts.append('                            </ul>')
    return "\n".join(html_parts)

def update_portfolio():
    print(f"Scanning directory: {FREELANCE_DIR}")
    
    if not os.path.exists(FREELANCE_DIR):
        print(f"Error: Directory not found: {FREELANCE_DIR}")
        return

    # Get valid files (ignore hidden files)
    files = [f for f in os.listdir(FREELANCE_DIR) if os.path.isfile(os.path.join(FREELANCE_DIR, f)) and not f.startswith('.')]
    print(f"Found {len(files)} files: {files}")

    new_content_html = generate_html(files)

    # Read index.html
    try:
        with open(INDEX_FILE, 'r', encoding='utf-8') as f:
            content = f.read()
    except Exception as e:
        print(f"Error reading index.html: {e}")
        return

    # Replace content between markers
    start_pos = content.find(MARKER_START)
    end_pos = content.find(MARKER_END)

    if start_pos != -1 and end_pos != -1:
        updated_content = (
            content[:start_pos + len(MARKER_START)] + 
            "\n" + new_content_html + "\n                            " + 
            content[end_pos:]
        )
        
        with open(INDEX_FILE, 'w', encoding='utf-8') as f:
            f.write(updated_content)
        print("Success! Portfolio updated with new files.")
    else:
        print("Error: Auto-generation markers not found in index.html")

if __name__ == "__main__":
    update_portfolio()
