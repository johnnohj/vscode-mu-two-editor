import { useRef, useEffect, useState } from 'preact/hooks';
import {
  Chart,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  TimeScale,
  ChartConfiguration,
  ChartData,
  ScatterDataPoint
} from 'chart.js';
import 'chartjs-adapter-date-fns';

// Register Chart.js components
Chart.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  TimeScale
);

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

interface PlotCanvasProps {
  data: PlotData[];
  config: PlotConfig;
  seriesCount: number;
  lastUpdate: number;
}

// Color palette for different series
const SERIES_COLORS = [
  '#1f77b4', // blue
  '#ff7f0e', // orange
  '#2ca02c', // green
  '#d62728', // red
  '#9467bd', // purple
  '#8c564b', // brown
  '#e377c2', // pink
  '#7f7f7f', // gray
  '#bcbd22', // olive
  '#17becf'  // cyan
];

export function PlotCanvas({ data, config, seriesCount, lastUpdate }: PlotCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    if (!canvasRef.current || data.length === 0) return;

    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;

    // Destroy existing chart
    if (chartRef.current) {
      chartRef.current.destroy();
    }

    // Prepare datasets for Chart.js
    const datasets = [];
    
    for (let seriesIndex = 0; seriesIndex < seriesCount; seriesIndex++) {
      const isEnabled = config.enabledSeries[seriesIndex] !== false;
      if (!isEnabled) continue;

      const seriesData: ScatterDataPoint[] = [];
      
      for (const point of data) {
        if (point.values[seriesIndex] !== undefined) {
          seriesData.push({
            x: point.timestamp,
            y: point.values[seriesIndex]
          });
        }
      }

      if (seriesData.length > 0) {
        datasets.push({
          label: `Series ${seriesIndex + 1}`,
          data: seriesData,
          borderColor: SERIES_COLORS[seriesIndex % SERIES_COLORS.length],
          backgroundColor: SERIES_COLORS[seriesIndex % SERIES_COLORS.length] + '20',
          borderWidth: 2,
          pointRadius: 1,
          pointHoverRadius: 4,
          fill: false,
          tension: 0.1
        });
      }
    }

    const chartData: ChartData<'line', ScatterDataPoint[]> = {
      datasets
    };

    // Calculate Y-axis range for auto-scaling
    let yMin = Infinity;
    let yMax = -Infinity;

    if (config.autoScale && data.length > 0) {
      for (const point of data) {
        for (let i = 0; i < point.values.length; i++) {
          if (config.enabledSeries[i] !== false) {
            const value = point.values[i];
            if (value < yMin) yMin = value;
            if (value > yMax) yMax = value;
          }
        }
      }
      
      // Add some padding
      const range = yMax - yMin;
      const padding = range * 0.1;
      yMin -= padding;
      yMax += padding;
    }

    const chartConfig: ChartConfiguration<'line', ScatterDataPoint[]> = {
      type: 'line',
      data: chartData,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: {
          duration: 0 // Disable animations for real-time plotting
        },
        interaction: {
          intersect: false,
          mode: 'index'
        },
        plugins: {
          title: {
            display: true,
            text: 'CircuitPython Data Plot',
            color: 'var(--vscode-foreground)'
          },
          legend: {
            display: seriesCount > 1,
            labels: {
              color: 'var(--vscode-foreground)',
              usePointStyle: true,
              pointStyle: 'line'
            }
          },
          tooltip: {
            callbacks: {
              title: (context) => {
                const timestamp = context[0]?.parsed?.x;
                if (timestamp) {
                  return new Date(timestamp).toLocaleTimeString();
                }
                return '';
              },
              label: (context) => {
                const seriesName = context.dataset.label;
                const value = context.parsed.y;
                return `${seriesName}: ${value.toFixed(3)}`;
              }
            }
          }
        },
        scales: {
          x: {
            type: 'time',
            time: {
              unit: 'second',
              displayFormats: {
                second: 'HH:mm:ss'
              }
            },
            title: {
              display: true,
              text: 'Time',
              color: 'var(--vscode-foreground)'
            },
            ticks: {
              color: 'var(--vscode-foreground)',
              maxTicksLimit: 10
            },
            grid: {
              color: 'var(--vscode-panel-border)'
            }
          },
          y: {
            title: {
              display: true,
              text: 'Value',
              color: 'var(--vscode-foreground)'
            },
            ticks: {
              color: 'var(--vscode-foreground)'
            },
            grid: {
              color: 'var(--vscode-panel-border)'
            },
            ...(config.autoScale && isFinite(yMin) && isFinite(yMax) ? {
              min: yMin,
              max: yMax
            } : {})
          }
        }
      }
    };

    // Create new chart
    chartRef.current = new Chart(ctx, chartConfig);
    setIsInitialized(true);

  }, [data, config, seriesCount, lastUpdate]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (chartRef.current) {
        chartRef.current.destroy();
      }
    };
  }, []);

  return (
    <div style={{ 
      width: '100%', 
      height: '100%', 
      position: 'relative',
      minHeight: '200px'
    }}>
      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          height: '100%'
        }}
      />
      {!isInitialized && data.length > 0 && (
        <div style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          color: 'var(--vscode-foreground)',
          fontSize: '14px'
        }}>
          Initializing chart...
        </div>
      )}
    </div>
  );
}