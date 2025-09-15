import { useEffect, useState, useCallback } from 'preact/hooks';
import { PlotCanvas } from './PlotCanvas';
import { DataControls } from './DataControls';
import styles from './Plotter.module.css';

interface PlotData {
  timestamp: number;
  values: number[];
  labels?: string[];
  series?: number;
}

interface PlotConfig {
  maxDataPoints: number;
  autoScale: boolean;
  timeWindow: number;
  enabledSeries: boolean[];
}

interface SerialMessage {
  data: string;
  timestamp: number;
  type?: string;
}

export function Plotter() {
  const [plotData, setPlotData] = useState<PlotData[]>([]);
  const [plotConfig, setPlotConfig] = useState<PlotConfig>({
    maxDataPoints: 500,
    autoScale: true,
    timeWindow: 60,
    enabledSeries: []
  });
  const [connected, setConnected] = useState(false);
  const [seriesCount, setSeriesCount] = useState(0);
  const [lastUpdate, setLastUpdate] = useState<number>(0);

  // StreamProcessor functionality integrated directly
  const tupleRegex = /^\s*\(([^)]+)\)\s*$/;
  const csvRegex = /^[0-9.,\-+e\s]+$/;

  const processMessage = useCallback((message: string): PlotData | null => {
    if (!message || message.length > 1024) {
      return null;
    }

    const lines = message.split('\n');
    let plotData: PlotData | null = null;

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (!trimmedLine) continue;

      // Try to parse as tuple format: (value1, value2, value3)
      const tupleMatch = trimmedLine.match(tupleRegex);
      if (tupleMatch) {
        plotData = parseTupleData(tupleMatch[1]);
        if (plotData) break;
      }

      // Try to parse as CSV format: value1,value2,value3
      if (csvRegex.test(trimmedLine) && trimmedLine.includes(',')) {
        plotData = parseCSVData(trimmedLine);
        if (plotData) break;
      }
    }

    return plotData;
  }, []);

  const parseTupleData = useCallback((tupleContent: string): PlotData | null => {
    try {
      const values = tupleContent
        .split(',')
        .map(val => {
          const trimmed = val.trim();
          const parsed = parseFloat(trimmed);
          return isNaN(parsed) ? null : parsed;
        })
        .filter(val => val !== null) as number[];

      if (values.length === 0) return null;

      return {
        timestamp: Date.now(),
        values,
        series: values.length
      };
    } catch (error) {
      return null;
    }
  }, []);

  const parseCSVData = useCallback((csvContent: string): PlotData | null => {
    try {
      const values = csvContent
        .split(',')
        .map(val => {
          const trimmed = val.trim();
          const parsed = parseFloat(trimmed);
          return isNaN(parsed) ? null : parsed;
        })
        .filter(val => val !== null) as number[];

      if (values.length === 0) return null;

      return {
        timestamp: Date.now(),
        values,
        series: values.length
      };
    } catch (error) {
      return null;
    }
  }, []);

  // Handle messages from VS Code extension
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      
      switch (message.type) {
        case 'serialData':
          // Process the message data for plot data
          if (message.data && message.data.payload) {
            const messageText = message.data.payload.data || '';
            const newPlotData = processMessage(messageText);
            
            if (newPlotData) {
              setPlotData(prev => {
                const updated = [...prev, newPlotData];
                // Keep only the last maxDataPoints
                if (updated.length > plotConfig.maxDataPoints) {
                  return updated.slice(-plotConfig.maxDataPoints);
                }
                return updated;
              });
              setLastUpdate(Date.now());
              
              // Update series count if needed
              if (newPlotData.series && newPlotData.series > seriesCount) {
                setSeriesCount(newPlotData.series);
                // Enable all series by default
                setPlotConfig(prev => {
                  const newEnabledSeries = [...prev.enabledSeries];
                  while (newEnabledSeries.length < newPlotData.series!) {
                    newEnabledSeries.push(true);
                  }
                  return { ...prev, enabledSeries: newEnabledSeries };
                });
              }
            }
          }
          break;

        case 'terminalWrite':
          // Also check terminal writes for plot data
          if (message.data) {
            const newPlotData = processMessage(message.data);
            if (newPlotData) {
              setPlotData(prev => {
                const updated = [...prev, newPlotData];
                if (updated.length > plotConfig.maxDataPoints) {
                  return updated.slice(-plotConfig.maxDataPoints);
                }
                return updated;
              });
              setLastUpdate(Date.now());
              
              if (newPlotData.series && newPlotData.series > seriesCount) {
                setSeriesCount(newPlotData.series);
                setPlotConfig(prev => {
                  const newEnabledSeries = [...prev.enabledSeries];
                  while (newEnabledSeries.length < newPlotData.series!) {
                    newEnabledSeries.push(true);
                  }
                  return { ...prev, enabledSeries: newEnabledSeries };
                });
              }
            }
          }
          break;

        case 'connectionStatus':
          setConnected(message.connected || false);
          break;
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [processMessage, plotConfig.maxDataPoints, seriesCount]);

  const handleClearPlot = useCallback(() => {
    setPlotData([]);
    setLastUpdate(Date.now());
    if (window.vscode) {
      window.vscode.postMessage({ type: 'plotterClear' });
    }
  }, []);

  const handleConfigUpdate = useCallback((newConfig: Partial<PlotConfig>) => {
    setPlotConfig(prev => ({ ...prev, ...newConfig }));
  }, []);

  const handleExportData = useCallback((format: 'csv' | 'json') => {
    if (window.vscode) {
      window.vscode.postMessage({ 
        type: 'plotterExport',
        format,
        data: {
          plotData,
          config: plotConfig,
          seriesCount
        }
      });
    }
  }, [plotData, plotConfig, seriesCount]);

  const handleToggleSeries = useCallback((seriesIndex: number) => {
    setPlotConfig(prev => {
      const newEnabledSeries = [...prev.enabledSeries];
      if (seriesIndex < newEnabledSeries.length) {
        newEnabledSeries[seriesIndex] = !newEnabledSeries[seriesIndex];
      }
      return { ...prev, enabledSeries: newEnabledSeries };
    });
  }, []);

  return (
    <div className={styles.plotter}>
      <div className={styles.header}>
        <div className={styles.status}>
          <span className={`${styles.indicator} ${connected ? styles.connected : styles.disconnected}`}>
            {connected ? '●' : '○'}
          </span>
          <span className={styles.statusText}>
            {connected ? 'Connected' : 'Disconnected'} 
            {plotData.length > 0 && ` • ${plotData.length} points`}
          </span>
        </div>
      </div>
      
      <DataControls
        config={plotConfig}
        seriesCount={seriesCount}
        dataPointCount={plotData.length}
        onConfigUpdate={handleConfigUpdate}
        onClearPlot={handleClearPlot}
        onExportData={handleExportData}
        onToggleSeries={handleToggleSeries}
      />
      
      <div className={styles.plotContainer}>
        {plotData.length > 0 ? (
          <PlotCanvas
            data={plotData}
            config={plotConfig}
            seriesCount={seriesCount}
            lastUpdate={lastUpdate}
          />
        ) : (
          <div className={styles.emptyState}>
            <div className={styles.emptyContent}>
              <h3>No Data to Plot</h3>
              <p>
                {connected 
                  ? 'Waiting for tuple or CSV data from CircuitPython...'
                  : 'Connect to a CircuitPython device to start plotting data.'
                }
              </p>
              <div className={styles.exampleCode}>
                <h4>Example CircuitPython Code:</h4>
                <pre>{`import time
import random

while True:
    temp = 20 + random.random() * 10
    humidity = 40 + random.random() * 20
    
    # This will be automatically plotted
    print((time.monotonic(), temp, humidity))
    
    time.sleep(1)`}</pre>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}