# Testing Implementation Guide: Common Workflow Activities

This guide provides detailed implementation patterns for testing the most common user workflows in the Mu 2 VS Code extension.

## Key Workflow Tests

### 1. Fresh Extension Activation Test
- **Measures**: Activation time, component initialization, device detection
- **Performance Target**: < 3 seconds to fully ready
- **Critical Path**: Extension activation → workspace detection → device connection → features available

### 2. Save Twice Strategy Test  
- **Tests**: Local save + device transfer workflow
- **Scenarios**: Connected device, disconnected device, pending sync
- **Performance Target**: < 8 seconds for complete save cycle

### 3. Board Association & Reconnection Test
- **Validates**: Workspace-device association, reconnection prompts, sync behavior
- **Performance Target**: < 5 seconds for reconnection flow

### 4. Plotter Activation Test
- **Covers**: Feature discovery, real-time data plotting, UI controls
- **Performance Target**: < 5 seconds activation, real-time data handling

## Implementation Framework

```typescript
export class CommonWorkflowTestRunner {
    private testSuite: WorkflowTestFramework[] = [
        new FreshActivationWithExistingWorkspaceTest(),
        new SaveTwiceWorkflowTest(),
        new AssociatedBoardReconnectionTest(),
        new PlotterActivationTest()
    ];
    
    async runAllWorkflowTests(): Promise<WorkflowTestResults> {
        // Execute all tests with performance monitoring
        // Return comprehensive results with metrics
    }
    
    async runSpecificWorkflow(workflowType: WorkflowType): Promise<TestResult> {
        // Run individual workflow test
        // Detailed validation and reporting
    }
}
```

## Mock Device System

```typescript
export class MockDeviceManager {
    async connectDevice(deviceConfig: MockDeviceConfig): Promise<void> {
        // Simulate realistic device connection timing
        // Fire appropriate events for testing
    }
    
    async disconnectDevice(boardId: string): Promise<void> {
        // Simulate device disconnection
        // Test disconnection handling
    }
}
```

## Performance Benchmarking

```typescript
const performanceTargets = {
    [WorkflowType.FRESH_ACTIVATION]: { maxTime: 3000, maxMemory: 50MB },
    [WorkflowType.SAVE_TWICE]: { maxTime: 8000, maxMemory: 30MB },
    [WorkflowType.BOARD_RECONNECTION]: { maxTime: 5000, maxMemory: 25MB },
    [WorkflowType.PLOTTER_ACTIVATION]: { maxTime: 5000, maxMemory: 40MB }
};
```

## Usage in Test Suites

```typescript
describe('Mu 2 Extension Common Workflows', () => {
    it('should pass all workflow tests', async () => {
        const results = await new CommonWorkflowTestRunner().runAllWorkflowTests();
        expect(results.failed).toBe(0);
        expect(results.passed).toBe(results.totalTests);
    });
    
    it('should meet performance targets', async () => {
        // Validate each workflow meets timing and memory requirements
        // Catch performance regressions
    });
});
```

## CI/CD Integration

```json
{
    "scripts": {
        "test:workflows": "vscode-test --extensionTestsPath=./out/test/workflows",
        "test:workflows:ci": "npm run test:workflows -- --reporter=json --outputFile=test-results.json",
        "test:workflow:activation": "npm run test:workflows -- --grep='activation'",
        "test:workflow:save": "npm run test:workflows -- --grep='save'"
    }
}
```

This testing framework ensures your critical user workflows function correctly, perform well, and don't regress over time. It provides both comprehensive validation and performance benchmarking for the most important user journeys in your extension.
