import { useState, useCallback } from 'preact/hooks';
import styles from './DataControls.module.css';

interface PlotConfig {
  maxDataPoints: number;
  autoScale: boolean;  
  timeWindow: number;
  enabledSeries: boolean[];
}

interface DataControlsProps {
  config: PlotConfig;
  seriesCount: number;
  dataPointCount: number;
  onConfigUpdate: (config: Partial<PlotConfig>) => void;
  onClearPlot: () => void;
  onExportData: (format: 'csv' | 'json') => void;
  onToggleSeries: (seriesIndex: number) => void;
}

export function DataControls({
  config,
  seriesCount,
  dataPointCount,
  onConfigUpdate,
  onClearPlot,
  onExportData,
  onToggleSeries
}: DataControlsProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const handleMaxDataPointsChange = useCallback((e: Event) => {
    const target = e.target as HTMLInputElement;
    const value = parseInt(target.value, 10);
    if (!isNaN(value) && value > 0) {
      onConfigUpdate({ maxDataPoints: value });
    }
  }, [onConfigUpdate]);

  const handleTimeWindowChange = useCallback((e: Event) => {
    const target = e.target as HTMLInputElement;
    const value = parseInt(target.value, 10);
    if (!isNaN(value) && value > 0) {
      onConfigUpdate({ timeWindow: value });
    }
  }, [onConfigUpdate]);

  const handleAutoScaleToggle = useCallback(() => {
    onConfigUpdate({ autoScale: !config.autoScale });
  }, [config.autoScale, onConfigUpdate]);

  const generateSeriesControls = () => {
    const controls = [];
    for (let i = 0; i < seriesCount; i++) {
      const isEnabled = config.enabledSeries[i] !== false;
      controls.push(
        <label key={i} className={styles.seriesControl}>
          <input
            type="checkbox"
            checked={isEnabled}
            onChange={() => onToggleSeries(i)}
            className={styles.seriesCheckbox}
          />
          <span className={styles.seriesLabel}>Series {i + 1}</span>
          <span 
            className={styles.seriesIndicator}
            style={{ 
              backgroundColor: isEnabled ? getSeriesColor(i) : '#666',
              opacity: isEnabled ? 1 : 0.5
            }}
          />
        </label>
      );
    }
    return controls;
  };

  return (
    <div className={styles.controls}>
      <div className={styles.toolbar}>
        <button
          onClick={onClearPlot}
          className={styles.button}
          disabled={dataPointCount === 0}
          title="Clear all plot data"
        >
          Clear
        </button>
        
        {dataPointCount > 0 && (
          <>
            <button
              onClick={() => onExportData('csv')}
              className={styles.button}
              title="Export data as CSV"
            >
              Export CSV
            </button>
            <button
              onClick={() => onExportData('json')}
              className={styles.button}
              title="Export data as JSON"
            >
              Export JSON
            </button>
          </>
        )}
        
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className={`${styles.button} ${isExpanded ? styles.active : ''}`}
          title="Toggle settings"
        >
          Settings
        </button>
      </div>

      {isExpanded && (
        <div className={styles.settings}>
          <div className={styles.settingsRow}>
            <label className={styles.settingLabel}>
              Max Data Points:
              <input
                type="number"
                value={config.maxDataPoints}
                onChange={handleMaxDataPointsChange}
                min="10"
                max="5000"
                step="10"
                className={styles.numberInput}
              />
            </label>
            
            <label className={styles.settingLabel}>
              Time Window (seconds):
              <input
                type="number"
                value={config.timeWindow}
                onChange={handleTimeWindowChange}
                min="5"
                max="3600"
                step="5"
                className={styles.numberInput}
              />
            </label>
            
            <label className={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={config.autoScale}
                onChange={handleAutoScaleToggle}
                className={styles.checkbox}
              />
              Auto Scale Y-Axis
            </label>
          </div>

          {seriesCount > 0 && (
            <div className={styles.seriesControls}>
              <h4 className={styles.seriesTitle}>Data Series:</h4>
              <div className={styles.seriesGrid}>
                {generateSeriesControls()}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Helper function to get series color
function getSeriesColor(index: number): string {
  const colors = [
    '#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd',
    '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf'
  ];
  return colors[index % colors.length];
}