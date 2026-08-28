import { getLunaraNativeBridge } from './bridge'
import { isNative } from './runtime'

interface NativeReportBridge {
  printReport(options: { jobName: string }): Promise<void>
}

export interface ReportExportDependencies {
  native?: boolean
  bridge?: NativeReportBridge
  browserPrint?: () => void
}

/**
 * Opens the platform print/export sheet for the currently rendered report.
 *
 * `window.print()` is intentionally limited to the browser path: WKWebView and
 * Android WebView do not reliably surface a print dialog for that call.
 */
export async function exportCurrentReport(
  jobName = 'Ruby cycle report',
  dependencies: ReportExportDependencies = {},
): Promise<void> {
  const native = dependencies.native ?? isNative

  if (native) {
    const bridge =
      dependencies.bridge ?? getLunaraNativeBridge<NativeReportBridge>()
    await bridge.printReport({ jobName })
    return
  }

  const browserPrint = dependencies.browserPrint ?? (() => window.print())
  browserPrint()
}
