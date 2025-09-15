// Copyright (c) Mu Two Editor contributors.
// Licensed under the MIT License.

'use strict';

/**
 * CircuitPython Type Definitions
 * Based on CircuitPython API documentation and stubs
 */

export interface CircuitPythonModule {
    name: string;
    description: string;
    classes: CircuitPythonClass[];
    functions: CircuitPythonFunction[];
    constants: CircuitPythonConstant[];
    enums: CircuitPythonEnum[];
}

export interface CircuitPythonClass {
    name: string;
    description: string;
    constructor: CircuitPythonFunction;
    methods: CircuitPythonFunction[];
    properties: CircuitPythonProperty[];
    staticMethods: CircuitPythonFunction[];
    classVars: CircuitPythonProperty[];
}

export interface CircuitPythonFunction {
    name: string;
    description: string;
    parameters: CircuitPythonParameter[];
    returnType: string;
    signature: string;
    examples?: string[];
    isAsync?: boolean;
    isStatic?: boolean;
    isClassMethod?: boolean;
    isProperty?: boolean;
}

export interface CircuitPythonParameter {
    name: string;
    type: string;
    description: string;
    optional: boolean;
    defaultValue?: string;
}

export interface CircuitPythonProperty {
    name: string;
    type: string;
    description: string;
    readonly: boolean;
    examples?: string[];
}

export interface CircuitPythonConstant {
    name: string;
    value: string;
    type: string;
    description: string;
}

export interface CircuitPythonEnum {
    name: string;
    description: string;
    values: Array<{
        name: string;
        value: string | number;
        description: string;
    }>;
}

export interface BoardDefinition {
    id: string;
    name: string;
    displayName: string;
    description: string;
    pins: BoardPin[];
    aliases: Record<string, string>;
    builtinModules: string[];
    supportedProtocols: string[];
    firmwareInfo: {
        minVersion: string;
        maxVersion?: string;
        features: string[];
    };
}

export interface BoardPin {
    name: string;
    number: number;
    description: string;
    aliases: string[];
    capabilities: PinCapability[];
    protocols: string[];
}

export interface PinCapability {
    type: 'digital' | 'analog' | 'pwm' | 'i2c' | 'spi' | 'uart' | 'can';
    properties: Record<string, any>;
}

export interface CompletionContext {
    module?: string;
    objectType?: string;
    memberAccess: boolean;
    position: number;
    line: string;
    boardId?: string;
}

export interface HoverInfo {
    title: string;
    description: string;
    signature?: string;
    examples?: string[];
    documentation?: string;
    url?: string;
}

export interface SignatureInfo {
    signature: string;
    description: string;
    parameters: Array<{
        name: string;
        description: string;
        optional: boolean;
        type?: string;
    }>;
    returnType?: string;
}

// Core CircuitPython module definitions
export const CORE_MODULES = {
    DIGITAL_IO: 'digitalio',
    ANALOG_IO: 'analogio',
    BUS_IO: 'busio',
    BOARD: 'board',
    MICROCONTROLLER: 'microcontroller',
    TIME: 'time',
    MATH: 'math',
    RANDOM: 'random',
    OS: 'os',
    SYS: 'sys',
    GC: 'gc',
    STORAGE: 'storage',
    SUPERVISOR: 'supervisor'
} as const;

export const COMMON_LIBRARIES = {
    // Adafruit Libraries
    NEOPIXEL: 'neopixel',
    ADAFRUIT_MOTOR: 'adafruit_motor',
    ADAFRUIT_DISPLAY_TEXT: 'adafruit_display_text',
    ADAFRUIT_BITMAP_FONT: 'adafruit_bitmap_font',
    ADAFRUIT_IMAGELOAD: 'adafruit_imageload',
    ADAFRUIT_REQUESTS: 'adafruit_requests',
    ADAFRUIT_CONNECTION_MANAGER: 'adafruit_connection_manager',
    ADAFRUIT_ESP32SPI: 'adafruit_esp32spi',
    ADAFRUIT_MOTOR_KIT: 'adafruit_motor.motor_kit',
    ADAFRUIT_SERVO_KIT: 'adafruit_motor.servo_kit',
    
    // Display Libraries
    DISPLAYIO: 'displayio',
    TERMINALIO: 'terminalio',
    VECTORIO: 'vectorio',
    BITMAPTOOLS: 'bitmaptools',
    
    // Audio Libraries
    AUDIOCORE: 'audiocore',
    AUDIOBUSIO: 'audiobusio',
    AUDIOMP3: 'audiomp3',
    AUDIOPWMIO: 'audiopwmio',
    
    // Sensor Libraries
    ADAFRUIT_BME280: 'adafruit_bme280',
    ADAFRUIT_BNO055: 'adafruit_bno055',
    ADAFRUIT_LIS3DH: 'adafruit_lis3dh',
    ADAFRUIT_DHT: 'adafruit_dht',
    ADAFRUIT_DS18X20: 'adafruit_ds18x20'
} as const;

export type ModuleName = typeof CORE_MODULES[keyof typeof CORE_MODULES] | 
                        typeof COMMON_LIBRARIES[keyof typeof COMMON_LIBRARIES];

// Type definitions for IntelliSense integration
export interface LanguageServerContext {
    boardDefinition?: BoardDefinition;
    availableModules: string[];
    importedModules: Record<string, CircuitPythonModule>;
    currentScope: string[];
}

export interface CodeIntelligenceProvider {
    provideCompletions(context: CompletionContext): Promise<CompletionItem[]>;
    provideHover(word: string, context: CompletionContext): Promise<HoverInfo | null>;
    provideSignatureHelp(functionName: string, context: CompletionContext): Promise<SignatureInfo | null>;
    provideDiagnostics(code: string, boardId?: string): Promise<Diagnostic[]>;
}

export interface CompletionItem {
    label: string;
    kind: CompletionItemKind;
    detail?: string;
    documentation?: string;
    insertText?: string;
    filterText?: string;
    sortText?: string;
    preselect?: boolean;
    data?: any;
}

export enum CompletionItemKind {
    Text = 1,
    Method = 2,
    Function = 3,
    Constructor = 4,
    Field = 5,
    Variable = 6,
    Class = 7,
    Interface = 8,
    Module = 9,
    Property = 10,
    Unit = 11,
    Value = 12,
    Enum = 13,
    Keyword = 14,
    Snippet = 15,
    Color = 16,
    File = 17,
    Reference = 18,
    Folder = 19,
    EnumMember = 20,
    Constant = 21,
    Struct = 22,
    Event = 23,
    Operator = 24,
    TypeParameter = 25
}

export interface Diagnostic {
    range: {
        start: { line: number; character: number };
        end: { line: number; character: number };
    };
    message: string;
    severity: DiagnosticSeverity;
    source: string;
    code?: string | number;
    tags?: DiagnosticTag[];
    relatedInformation?: DiagnosticRelatedInformation[];
}

export enum DiagnosticSeverity {
    Error = 1,
    Warning = 2,
    Information = 3,
    Hint = 4
}

export enum DiagnosticTag {
    Unnecessary = 1,
    Deprecated = 2
}

export interface DiagnosticRelatedInformation {
    location: {
        uri: string;
        range: {
            start: { line: number; character: number };
            end: { line: number; character: number };
        };
    };
    message: string;
}

// Configuration for CircuitPython Language Service
export interface CircuitPythonLanguageServiceConfig {
    enableDiagnostics: boolean;
    enableCompletions: boolean;
    enableHover: boolean;
    enableSignatureHelp: boolean;
    strictPinValidation: boolean;
    enableBoardSpecificCompletions: boolean;
}

// Position in document
export interface Position {
    line: number;
    character: number;
}

// Enhanced completion context for JSON-RPC service
export interface CompletionContextEnhanced extends CompletionContext {
    triggerKind?: 'invoked' | 'triggerCharacter' | 'incomplete';
    triggerCharacter?: string;
}

// Signature help for JSON-RPC service
export interface SignatureHelp {
    signatures: Array<{
        label: string;
        documentation?: string;
        parameters: Array<{
            label: string;
            documentation?: string;
        }>;
    }>;
    activeSignature: number;
    activeParameter: number;
}

// Type aliases for compatibility with existing code
export type CircuitPythonBoard = BoardDefinition;

// Module member for simplified access
export interface ModuleMember {
    name: string;
    type: 'function' | 'property' | 'class' | 'constant';
    description: string;
    parameters?: CircuitPythonParameter[];
    example?: string;
}