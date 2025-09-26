# Workspace Synchronization Flow Charts

## Overview
This document outlines the synchronization flows for the dual-workspace architecture:
- **workspaceFolders[0]** (main): User's primary editing location (always present)
- **workspaceFolders[1]** (CIRCUITPY): Physical device (intermittently connected)
- **`.projects/.current/`**: Last-known CIRCUITPY state (source of truth for device sync)

---

## Flow 1: Board Connection Detection

```mermaid
flowchart TD
    A[Board Connected] --> B{Is workspaceFolders[1] already present?}
    B -->|No| C[Add CIRCUITPY as workspaceFolders[1]]
    B -->|Yes| D[Update existing workspaceFolders[1] reference]

    C --> E[Read current CIRCUITPY files]
    D --> E

    E --> F{Compare CIRCUITPY vs .projects/.current/}
    F -->|Identical| G[No action needed - in sync]
    F -->|Different| H[Detect sync conflict]

    H --> I{What changed?}
    I -->|CIRCUITPY newer| J[Show: 'Board has newer files. Sync from board?']
    I -->|.current newer| K[Show: 'Local changes exist. Sync to board?']
    I -->|Both changed| L[Show: 'Conflict detected. Choose sync direction']

    J --> M{User choice}
    K --> N{User choice}
    L --> O{User choice}

    M -->|Sync from board| P[Copy CIRCUITPY → workspaceFolders[0] + .current]
    M -->|Keep local| Q[Copy .current → CIRCUITPY]

    N -->|Sync to board| Q
    N -->|Keep board| P

    O -->|Use board| P
    O -->|Use local| Q
    O -->|Manual merge| R[Open diff/merge interface]

    P --> S[Update .current with new state]
    Q --> S
    R --> S

    S --> T[Sync complete]
```

---

## Flow 2: Board Disconnection

```mermaid
flowchart TD
    A[Board Disconnected] --> B[Remove workspaceFolders[1] reference]
    B --> C[Preserve .projects/.current/ as-is]
    C --> D[User continues editing workspaceFolders[0]]
    D --> E[.current/ becomes 'frozen snapshot' of last device state]
    E --> F[Divergence begins between workspace[0] and .current/]
```

---

## Flow 3: File Save (saveTwiceHandler)

```mermaid
flowchart TD
    A[User saves file in workspaceFolders[0]] --> B{Is project in .projects/ProjectName?}
    B -->|No| C[Prompt Save Project As]
    B -->|Yes| D[Sync to .projects/ProjectName]

    C --> E[User provides ProjectName]
    E --> F[Create .projects/ProjectName]
    F --> D

    D --> G{Is CIRCUITPY connected?}
    G -->|Yes| H[Copy to CIRCUITPY + update .current]
    G -->|No| I[Only update .projects/ProjectName]

    H --> J[Sync complete - all locations updated]
    I --> K[CIRCUITPY will sync when reconnected]
```

---

## Flow 4: Create New Project

```mermaid
flowchart TD
    A[Create New Project] --> B{Current work has unsaved changes?}
    B -->|Yes| C{Project exists in .projects/ProjectName?}
    B -->|No| D[Clear workspaceFolders[0] files]

    C -->|Yes| E[Save changes to .projects/ProjectName]
    C -->|No| F[Prompt user to Save project as... or delete]

    E --> D
    F --> G{User choice}
    G -->|Save As| H[User provides ProjectName]
    G -->|Delete| D

    H --> I[Create .projects/ProjectName]
    I --> D

    D --> J[Create basic project structure in workspaceFolders[0]]
    J --> K{Is CIRCUITPY connected?}

    K -->|Yes| L[Clear CIRCUITPY files]
    K -->|No| M[Continue without device sync]

    L --> N[Copy new structure to CIRCUITPY]
    N --> O[Update .current with new state]
    M --> P[.current remains with old state]

    O --> Q[New project ready - all synced]
    P --> Q
```

---

## Flow 5: Load Existing Project

```mermaid
flowchart TD
    A[Load Project: ProjectName] --> B{Current work needs backup?}
    B -->|Yes| C[Backup current work]
    B -->|No| D[Clear workspaceFolders[0]]

    C --> D
    D --> E[Copy .projects/ProjectName → workspaceFolders[0]]
    E --> F[Copy .projects/ProjectName → .projects/.current]
    F --> G{Is CIRCUITPY connected?}

    G -->|Yes| H[Copy ProjectName → CIRCUITPY]
    G -->|No| I[CIRCUITPY will sync when reconnected]

    H --> J[All locations synced with ProjectName]
    I --> J
```

---

## Flow 6: Save Project As

```mermaid
flowchart TD
    A[Save Project As: NewName] --> B[Get current state from workspaceFolders[0]]
    B --> C[Save to .projects/NewName/]
    C --> D[Update .current with current state]
    D --> E{Is CIRCUITPY connected?}

    E -->|Yes| F[CIRCUITPY already matches workspaceFolders[0]]
    E -->|No| G[CIRCUITPY will sync when reconnected]

    F --> H[Project saved - all synced]
    G --> H
```

---

## Architecture Decisions (Based on User Clarifications)

### 1. Board Association
- **One board per workspace** - Each workspace associated with single board via `.vscode/mu2-{id}`
- Board identification determines sync target and conflict resolution

### 2. Conflict Resolution UI
- **Simple dialogs** - Basic choice prompts rather than complex diff interfaces
- Options: "Use Board", "Use Local", "Cancel" for most conflicts

### 3. User Preferences
- **Always ask** - No automatic sync direction preferences
- User makes conscious decisions for each conflict scenario

### 4. Library Synchronization
- **Same logic as code.py** - `lib/` changes trigger full sync flows
- **Different targets**: CIRCUITPY gets direct copy, .projects/ProjectName gets saved state

### 5. Sync Timing
- **Event-driven only** - No background polling or periodic checks
- Triggers: File save, board connect/disconnect, explicit user actions

### 6. Drive Name Configuration
- **User-configurable drive name** - Default "CIRCUITPY" but allow custom names
- Setting: `muTwo.circuitPythonDriveName` (string, default: "CIRCUITPY")
- Used in drive detection logic for workspaceFolders[1] identification

---

## Implementation Notes

### Key Components Needed:
1. **SyncCoordinator**: Orchestrates all sync operations between three locations
2. **ProjectStateManager**: Tracks current project name and manages .projects/ operations
3. **ConflictResolver**: Simple dialog-based conflict resolution
4. **ProjectManager**: Enhanced for triple-location sync (workspace/circuitpy/projects)
5. **saveTwiceHandler**: Project-aware saving with sync coordination

### Data Structures:
```typescript
interface SyncState {
    currentProjectName: string | null;
    lastSyncTimestamp: string;
    workspaceChecksum: string;
    circuitpyChecksum: string | null;
    projectChecksum: string | null;
    boardConnected: boolean;
    customDriveName: string;    // User-configured drive name
}

interface ProjectSyncTargets {
    workspace: vscode.Uri;      // workspaceFolders[0] - user editing
    circuitpy: vscode.Uri | null;  // workspaceFolders[1] - device (optional)
    project: vscode.Uri | null;    // .projects/ProjectName - persistent state
    current: vscode.Uri;        // .projects/.current - last device snapshot
}

interface DriveDetectionConfig {
    driveName: string;          // User setting: muTwo.circuitPythonDriveName
    commonPaths: string[];      // Platform-specific search paths
    boardIdentifier?: string;   // .vscode/mu2-{id} for validation
}
```

### Sync Patterns:
- **Save with project**: workspace → .projects/ProjectName → CIRCUITPY (if connected)
- **Save without project**: prompt for project name, then save pattern above
- **Board connect**: compare CIRCUITPY vs .current, resolve conflicts, sync all
- **Load project**: .projects/ProjectName → workspace + .current → CIRCUITPY (if connected)