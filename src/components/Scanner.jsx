import React, { useEffect, useRef, useState } from 'react'
import { Html5Qrcode } from 'html5-qrcode'
import './Scanner.css'

// Pitido de confirmación al leer un código (como un lector de supermercado)
function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.type = 'square'
    osc.frequency.value = 1500
    gain.gain.setValueAtTime(0.35, ctx.currentTime)
    osc.start()
    osc.stop(ctx.currentTime + 0.18)
    osc.onended = () => ctx.close()
  } catch {
    // sin audio disponible, seguimos igual
  }
}

export default function Scanner({ onScan, onClose }) {
  const scannerRef = useRef(null)
  const [error, setError] = useState('')
  const [starting, setStarting] = useState(true)

  // onScan es una función nueva en cada render del padre. Si el efecto
  // dependiera de ella, CADA cambio de estado del padre (una venta que entra,
  // el sync, un contador) apagaba y volvía a prender la cámara: en el celular
  // se traba, tarda en enfocar y se pierden lecturas. Por eso la cámara se
  // arranca UNA sola vez y el callback se lee de un ref siempre actualizado.
  const onScanRef = useRef(onScan)
  useEffect(() => { onScanRef.current = onScan })

  useEffect(() => {
    const scanner = new Html5Qrcode('qr-reader')
    scannerRef.current = scanner
    let stopped = false

    scanner
      .start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => {
          if (stopped) return
          stopped = true
          beep()
          scanner
            .stop()
            .catch(() => {})
            .finally(() => onScanRef.current(decodedText))
        }
      )
      .then(() => setStarting(false))
      .catch((err) => {
        setStarting(false)
        setError(
          'No se pudo acceder a la cámara. Verificá los permisos del navegador. (' +
            (err?.message || err) +
            ')'
        )
      })

    return () => {
      stopped = true
      if (scannerRef.current?.isScanning) {
        scannerRef.current.stop().catch(() => {})
      }
    }
    // Sin dependencias A PROPÓSITO: la cámara arranca y se apaga una sola vez
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="scanner-overlay">
      <div className="scanner-modal">
        <div className="scanner-header">
          <h2>📷 Escanear código</h2>
          <button className="scanner-close" onClick={onClose}>✕</button>
        </div>
        <div id="qr-reader" className="scanner-viewport"></div>
        {starting && <p className="scanner-hint">Iniciando cámara...</p>}
        {error ? (
          <p className="scanner-error">{error}</p>
        ) : (
          <p className="scanner-hint">
            Apuntá al código de barras del producto/combo o al QR de la etiqueta de MercadoLibre.
          </p>
        )}
      </div>
    </div>
  )
}
