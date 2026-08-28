import React from 'react'

// Íconos propios para lo que no existe como emoji. Usan currentColor y se
// alinean con el texto igual que un emoji, así entran en las solapas, los
// títulos y el cuadro de permisos sin tocar los estilos.
const base = {
  width: '1.3em',
  height: '1.3em',
  verticalAlign: '-0.28em',
  marginRight: '0.2em',
  flexShrink: 0,
}

const svgProps = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  style: base,
}

// Inventario: tres cajas apiladas (una arriba, dos abajo)
export const IconCajas = () => (
  <svg {...svgProps}>
    <rect x="7" y="2.5" width="10" height="7.5" rx="1" />
    <path d="M10.8 2.5v2.6h2.4V2.5" />
    <rect x="1.5" y="13.5" width="10" height="8" rx="1" />
    <path d="M5.3 13.5v2.7h2.4v-2.7" />
    <rect x="12.5" y="13.5" width="10" height="8" rx="1" />
    <path d="M16.3 13.5v2.7h2.4v-2.7" />
  </svg>
)

// Empaque: una caja con dos flechas entrando
export const IconEmpaque = () => (
  <svg {...svgProps}>
    <path d="M8 1.5v7.5" />
    <path d="M5 6 8 9l3-3" />
    <path d="M16 1.5v7.5" />
    <path d="M13 6l3 3 3-3" />
    <rect x="2.5" y="12" width="19" height="9.5" rx="1.5" />
    <path d="M2.5 15.5h19" />
  </svg>
)
