import * as vscode from 'vscode';
import * as learnGuidesDatabase from '../../data/learn_guides.json';
import { CircuitPythonDevice } from '../../devices/deviceDetector';

/**
 * TODO: Adafruit Learn Guides have their own GitHub repo, and as such, perhaps we should instead
 * consume that data directly from there to create a local .md file or similar for offline viewing.
 * This would be easier to maintain and update than a static .pdf file and, if we displayed the .md
 * as a preview, we would provide a familiar UX experience. -jef
 */
export interface LearnGuideInfo {
    board_name: string;
    learn_guide_url: string;
    guide_pdf_url?: string;
    manufacturer: string;
    board_family: string;
}

export interface BoardFamilyGuide {
    overview_url: string;
    getting_started_url: string;
}

export interface FallbackGuide {
    learn_guide_url: string;
    guide_pdf_url?: string;
}

/**
 * Provider for learn guide information and downloads
 */
export class LearnGuideProvider {
    private _outputChannel: vscode.OutputChannel;
    private _guidesDatabase: any;

    constructor() {
        this._outputChannel = vscode.window.createOutputChannel('Mu 2 Learn Guides');
        this._guidesDatabase = learnGuidesDatabase;
    }

    /**
     * Get learn guide information for a specific device
     */
    public getLearnGuideInfo(device: CircuitPythonDevice): LearnGuideInfo | null {
        if (!device.vendorId || !device.productId) {
            return null;
        }

        const vidPid = `${device.vendorId}:${device.productId}`;
        const mapping = this._guidesDatabase.vid_pid_mappings[vidPid];

        if (mapping) {
            return {
                board_name: mapping.board_name,
                learn_guide_url: mapping.learn_guide_url,
                guide_pdf_url: mapping.guide_pdf_url,
                manufacturer: mapping.manufacturer,
                board_family: mapping.board_family
            };
        }

        return null;
    }

    /**
     * Get learn guide URL for a device (fallback-aware)
     */
    public getLearnGuideUrl(device: CircuitPythonDevice): string | undefined {
        // Try specific board mapping first
        const guideInfo = this.getLearnGuideInfo(device);
        if (guideInfo) {
            return guideInfo.learn_guide_url;
        }

        // Fallback to manufacturer-specific guides
        if (device.vendorId === '0x239A' || device.manufacturer?.toLowerCase().includes('adafruit')) {
            return this._guidesDatabase.fallback_guides.adafruit_general.learn_guide_url;
        }

        // General CircuitPython fallback
        return this._guidesDatabase.fallback_guides.circuitpython_general.learn_guide_url;
    }

    /**
     * Get board family guide information
     */
    public getBoardFamilyGuide(boardFamily: string): BoardFamilyGuide | null {
        const familyGuide = this._guidesDatabase.board_family_guides[boardFamily];
        return familyGuide || null;
    }

    /**
     * Check if internet connectivity is available
     */
    public async checkConnectivity(): Promise<boolean> {
        try {
            // Try to fetch a simple HEAD request to a reliable endpoint
            const response = await fetch('https://learn.adafruit.com', {
                method: 'HEAD',
                signal: AbortSignal.timeout(5000) // 5 second timeout
            });
            return response.ok;
        } catch {
            return false;
        }
    }

    /**
     * Download learn guide PDF if available
     */
    public async downloadLearnGuide(
        device: CircuitPythonDevice,
        downloadPath: vscode.Uri
    ): Promise<boolean> {
        const guideInfo = this.getLearnGuideInfo(device);
        if (!guideInfo?.guide_pdf_url) {
            this._outputChannel.appendLine(`No PDF guide available for ${device.displayName}`);
            return false;
        }

        // Check connectivity first
        const isOnline = await this.checkConnectivity();
        if (!isOnline) {
            this._outputChannel.appendLine('No internet connectivity - skipping download');
            return false;
        }

        try {
            this._outputChannel.appendLine(`Downloading learn guide for ${device.displayName}...`);
            
            const response = await fetch(guideInfo.guide_pdf_url);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const pdfData = new Uint8Array(await response.arrayBuffer());
            const pdfPath = vscode.Uri.joinPath(downloadPath, 'board-guide.pdf');
            
            await vscode.workspace.fs.writeFile(pdfPath, pdfData);
            
            this._outputChannel.appendLine(`Learn guide downloaded: ${pdfPath.fsPath}`);
            return true;

        } catch (error) {
            this._outputChannel.appendLine(`Failed to download learn guide: ${error}`);
            return false;
        }
    }

    /**
     * Process pending downloads for all workspaces
     */
    public async processPendingDownloads(): Promise<void> {
        // This would iterate through all workspaces and process their pending downloads
        // Implementation would go here for Phase 2
        this._outputChannel.appendLine('Processing pending downloads (placeholder for Phase 2)');
    }

    /**
     * Get all supported board families
     */
    public getSupportedBoardFamilies(): string[] {
        return Object.keys(this._guidesDatabase.board_family_guides);
    }

    /**
     * Get all boards with learn guide mappings
     */
    public getSupportedBoards(): { vidPid: string; boardName: string; manufacturer: string }[] {
        const mappings = this._guidesDatabase.vid_pid_mappings;
        return Object.entries(mappings).map(([vidPid, info]: [string, any]) => ({
            vidPid,
            boardName: info.board_name,
            manufacturer: info.manufacturer
        }));
    }

    /**
     * Get database statistics
     */
    public getDatabaseStats(): {
        totalMappings: number;
        boardFamilies: number;
        supportedManufacturers: string[];
    } {
        const mappings = this._guidesDatabase.vid_pid_mappings;
        const manufacturers = new Set<string>();
        
        Object.values(mappings).forEach((info: any) => {
            manufacturers.add(info.manufacturer);
        });

        return {
            totalMappings: Object.keys(mappings).length,
            boardFamilies: Object.keys(this._guidesDatabase.board_family_guides).length,
            supportedManufacturers: Array.from(manufacturers)
        };
    }

    /**
     * Dispose resources
     */
    public dispose(): void {
        this._outputChannel.dispose();
    }
}