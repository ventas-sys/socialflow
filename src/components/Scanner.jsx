import React, { useEffect, useRef, useState } from 'react'
import { Html5Qrcode } from 'html5-qrcode'
import './Scanner.css'

export default function Scanner({ onScan, onClose }) {
  const scannerRef = useRef(null)
  const [error, setError] = useState('')
  const [starting, setStarting] = useState(true)

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
          scanner
            .stop()
            .catch(() => {})
            .finally(() => onScan(decodedText))
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
  }, [onScan])

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
            Apuntá al código QR de la etiqueta de MercadoLibre o al código de barras del producto.
          </p>
        )}
      </div>
    </div>
  )
}
