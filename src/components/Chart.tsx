import { useEffect, useRef } from 'react'
import type { EChartsCoreOption } from 'echarts/core'
import { use as registerEChartsModules } from 'echarts/core'
import { BarChart, LineChart, ScatterChart } from 'echarts/charts'
import {
  DatasetComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TooltipComponent,
} from 'echarts/components'
import { SVGRenderer } from 'echarts/renderers'
import * as echarts from 'echarts/core'

registerEChartsModules([
  BarChart,
  LineChart,
  ScatterChart,
  DatasetComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TooltipComponent,
  SVGRenderer,
])

interface ChartProps {
  option: EChartsCoreOption
  label: string
  height?: number
}

export function Chart({ option, label, height = 330 }: ChartProps) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!ref.current) return
    const chart = echarts.init(ref.current, undefined, { renderer: 'svg' })
    chart.setOption(option)
    const observer = new ResizeObserver(() => chart.resize())
    observer.observe(ref.current)
    return () => {
      observer.disconnect()
      chart.dispose()
    }
  }, [option])
  return <div ref={ref} className="chart" style={{ height }} role="img" aria-label={label} />
}
