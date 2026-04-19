import { useEffect, useRef, useState } from 'react'
import { BrowserMultiFormatReader } from '@zxing/browser'

export default function BarcodeScanner({ onDetected, onClose }) {
  const videoRef = useRef(null)
  const controlsRef = useRef(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    const reader = new BrowserMultiFormatReader()
    let cancelled = false

    const start = async () => {
      try {
        const devices = await BrowserMultiFormatReader.listVideoInputDevices()
        const back = devices.find(d => /back|rear|environment/i.test(d.label)) || devices[devices.length - 1]
        const deviceId = back?.deviceId
        const controls = await reader.decodeFromVideoDevice(
          deviceId,
          videoRef.current,
          (result, _err, ctrls) => {
            if (cancelled) return
            if (result) {
              ctrls.stop()
              onDetected(result.getText())
            }
          },
        )
        controlsRef.current = controls
      } catch (e) {
        setErr(`Camera error: ${e.message}. On iOS, use Safari and allow camera access. HTTPS is required except on localhost.`)
      }
    }

    start()
    return () => {
      cancelled = true
      controlsRef.current?.stop()
    }
  }, [onDetected])

  return (
    <div>
      <div className="scanner-wrap">
        <video ref={videoRef} playsInline muted />
      </div>
      {err && <div className="error">{err}</div>}
      <div style={{ marginTop: '0.75rem', textAlign: 'center' }}>
        <button className="secondary" onClick={onClose}>Cancel</button>
      </div>
      <p className="muted" style={{ textAlign: 'center', marginTop: '0.5rem' }}>
        Point camera at a product barcode (UPC/EAN).
      </p>
    </div>
  )
}
