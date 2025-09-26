Complete Mu Two Workspace Structure:

Standard Workspace Creation (from workspaceManager):

WorkspaceName/              # Main workspace (workspaceFolders[0])
├── .vscode/
│   └── mu2/
│       ├── workspace-config.json
│       ├── board-association.json
│       └── temp/downloads
├── lib/                    # Current project libraries
├── code.py                 # Current project entry
├── README.md
├── .resources/             # Board guide.md (Opens as webpage preview)
├── .libraries/             # User-modified libraries
└── .projects/              # Created by projectManager
	 ├── .current            # Backup directory
	 └── [ProjectName]/      # Named project saves
        └──pyproject.toml   # Project standard libraries (pointers to ../../.libraries/ for custom libraries?)

CIRCUITPY Drive Structure (workspaceFolders[1] - ctpyRoot):

CIRCUITPY/                # Device drive (workspaceFolders[1])
├── lib/                  # CircuitPython libraries
├── code.py               # Active code file
├── .vscode               # Device identification file (NEW)
│   └── mu2-{id}          # Scheme association file (NEW)
└── [other device files]

// TODO: Determine how best to handle custom libraries/tracking/storing