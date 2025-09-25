/**
 * Simple CircuitPython Device Detector
 * Replaces 4+ over-engineered device managers with one focused detector
 */

import * as vscode from 'vscode';
import { SerialPort } from 'serialport';

export interface CircuitPythonDevice {
    path: string;
    vendorId?: string;
    productId?: string;
    boardName?: string;
    isCircuitPython: boolean;
}

export class SimpleDeviceDetector {
    private devices: CircuitPythonDevice[] = [];
    private onDeviceChangedEmitter = new vscode.EventEmitter<CircuitPythonDevice[]>();
    public readonly onDeviceChanged = this.onDeviceChangedEmitter.event;

    /**
     * Find all CircuitPython devices connected via USB
     */
    async detectDevices(): Promise<CircuitPythonDevice[]> {
        try {
            const ports = await SerialPort.list();
            const circuitPythonDevices: CircuitPythonDevice[] = [];

            for (const port of ports) {
                if (this.isLikelyCircuitPython(port)) {
                    circuitPythonDevices.push({
                        path: port.path,
                        vendorId: port.vendorId,
                        productId: port.productId,
                        boardName: this.getBoardName(port.vendorId, port.productId),
                        isCircuitPython: true
                    });
                }
            }

            this.devices = circuitPythonDevices;
            this.onDeviceChangedEmitter.fire(this.devices);
            return this.devices;

        } catch (error) {
            console.error('Device detection failed:', error);
            return [];
        }
    }

    /**
     * Check if a serial port is likely a CircuitPython device
     */
    private isLikelyCircuitPython(port: any): boolean {
        if (!port.vendorId || !port.productId) return false;

        // Common CircuitPython VID/PIDs
        const circuitPythonVendors = [
            '239A', // Adafruit
            '2E8A', // Raspberry Pi
            '1209', // Generic
            '16C0'  // VOTI
        ];

        return circuitPythonVendors.includes(port.vendorId.toUpperCase());
    }

    /**
     * Get friendly board name from VID/PID
     */
    private getBoardName(vendorId?: string, productId?: string): string {
        if (!vendorId || !productId) return 'Unknown CircuitPython Board';

        // Simple board name lookup - could be expanded
        const boardMap: Record<string, string> = {
            '239A:8014': 'Adafruit Feather M0',
            '239A:8015': 'Adafruit Feather M4',
            '2E8A:0003': 'Raspberry Pi Pico',
            '2E8A:000A': 'Raspberry Pi Pico W'
        };

        const key = `${vendorId.toUpperCase()}:${productId.toUpperCase()}`;
        return boardMap[key] || 'CircuitPython Board';
    }

    /**
     * Get currently detected devices
     */
    getDevices(): CircuitPythonDevice[] {
        return [...this.devices];
    }

    /**
     * Start periodic device monitoring
     */
    startMonitoring(intervalMs: number = 2000): vscode.Disposable {
        const interval = setInterval(() => {
            this.detectDevices();
        }, intervalMs);

        return {
            dispose: () => clearInterval(interval)
        };
    }
}