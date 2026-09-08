// Clasificación del AMBA en cordones, para comparar lo que nos cobra ML por
// el envío contra lo que le pagamos al motoquero.
//
// Primero se busca la localidad (o el partido) en la tabla; si la dirección no
// aparece, se estima por distancia al Obelisco, que es como se dibujan los
// cordones en la práctica. La columna "Cómo se determinó" del Excel dice cuál
// de los dos criterios se usó, así lo que quede dudoso se puede revisar.

const norm = (s) => String(s || '')
  .toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9 ]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()

// Partido → localidades que lo componen (las más usadas en el conurbano)
const PRIMER_CORDON = {
  'avellaneda': ['avellaneda', 'sarandi', 'wilde', 'dock sud', 'villa dominico', 'gerli', 'pineyro', 'crucecita'],
  'lanus': ['lanus', 'lanus oeste', 'lanus este', 'remedios de escalada', 'valentin alsina', 'monte chingolo'],
  'lomas de zamora': ['lomas de zamora', 'banfield', 'temperley', 'turdera', 'llavallol', 'villa fiorito',
    'ingeniero budge', 'villa centenario', 'villa albertina', 'santa catalina', 'parque baron'],
  'la matanza': ['san justo', 'ramos mejia', 'villa luzuriaga', 'isidro casanova', 'casanova',
    'gregorio de laferrere', 'laferrere', 'gonzalez catan', 'rafael castillo', 'ciudad evita', 'tapiales',
    'aldo bonzi', 'lomas del mirador', 'la tablada', 'villa madero', 'virrey del pino', '20 de junio', 'san alberto'],
  'moron': ['moron', 'haedo', 'castelar', 'el palomar', 'villa sarmiento'],
  'tres de febrero': ['caseros', 'santos lugares', 'saenz pena', 'ciudadela', 'villa bosch', 'churruca',
    'loma hermosa', 'martin coronado', 'pablo podesta', 'jose ingenieros', 'el libertador', '11 de septiembre'],
  'general san martin': ['san martin', 'general san martin', 'villa ballester', 'jose leon suarez', 'villa maipu',
    'san andres', 'billinghurst', 'chilavert', 'malaver', 'villa lynch', 'villa libertad'],
  'vicente lopez': ['vicente lopez', 'olivos', 'florida', 'florida oeste', 'munro', 'carapachay',
    'villa martelli', 'la lucila'],
}

const SEGUNDO_CORDON = {
  'quilmes': ['quilmes', 'bernal', 'don bosco', 'ezpeleta', 'san francisco solano', 'solano', 'villa la florida'],
  'berazategui': ['berazategui', 'hudson', 'ranelagh', 'platanos', 'sourigues', 'juan maria gutierrez', 'gutierrez'],
  'florencio varela': ['florencio varela', 'bosques', 'zeballos', 'ingeniero allan', 'villa vatteone'],
  'almirante brown': ['adrogue', 'burzaco', 'claypole', 'longchamps', 'glew', 'rafael calzada', 'jose marmol',
    'ministro rivadavia', 'don orione', 'san jose'],
  'esteban echeverria': ['monte grande', 'luis guillon', '9 de abril', 'el jaguel', 'canning'],
  'ezeiza': ['ezeiza', 'tristan suarez', 'carlos spegazzini', 'spegazzini', 'la union', 'jose maria ezeiza'],
  'merlo': ['merlo', 'san antonio de padua', 'padua', 'libertad', 'mariano acosta', 'parque san martin', 'pontevedra'],
  'moreno': ['moreno', 'paso del rey', 'trujui', 'cuartel v', 'francisco alvarez', 'la reja'],
  'ituzaingo': ['ituzaingo', 'villa udaondo'],
  'hurlingham': ['hurlingham', 'william morris', 'villa tesei'],
  'san miguel': ['san miguel', 'bella vista', 'muniz', 'campo de mayo'],
  'jose c paz': ['jose c paz', 'jose c. paz'],
  'malvinas argentinas': ['los polvorines', 'grand bourg', 'villa de mayo', 'pablo nogues', 'tortuguitas',
    'ingeniero adolfo sourdeaux', 'sourdeaux'],
  'san isidro': ['san isidro', 'martinez', 'acassuso', 'beccar', 'boulogne', 'villa adelina', 'las lomas de san isidro'],
  'san fernando': ['san fernando', 'victoria', 'virreyes'],
  'tigre': ['tigre', 'don torcuato', 'el talar', 'general pacheco', 'benavidez', 'rincon de milberg', 'nordelta',
    'troncos del talar', 'dique lujan', 'ricardo rojas'],
}

const TERCER_CORDON = {
  'pilar': ['pilar', 'del viso', 'manzanares', 'villa rosa', 'presidente derqui', 'derqui', 'fatima', 'zelaya'],
  'escobar': ['belen de escobar', 'escobar', 'garin', 'maquinista savio', 'ingeniero maschwitz', 'maschwitz',
    'loma verde', 'matheu'],
  'general rodriguez': ['general rodriguez'],
  'marcos paz': ['marcos paz'],
  'canuelas': ['canuelas'],
  'presidente peron': ['guernica', 'presidente peron'],
  'san vicente': ['san vicente', 'alejandro korn', 'domselaar'],
  'la plata': ['la plata', 'city bell', 'gonnet', 'villa elisa', 'tolosa', 'los hornos', 'ringuelet',
    'melchor romero', 'manuel b gonnet', 'abasto'],
  'berisso': ['berisso'],
  'ensenada': ['ensenada', 'punta lara'],
  'brandsen': ['brandsen', 'coronel brandsen'],
  'lujan': ['lujan', 'open door'],
  'zarate': ['zarate', 'lima'],
  'campana': ['campana'],
  'exaltacion de la cruz': ['capilla del senor', 'exaltacion de la cruz'],
  'general las heras': ['general las heras'],
  'mercedes': ['mercedes'],
  'navarro': ['navarro'],
  'san andres de giles': ['san andres de giles'],
  'lobos': ['lobos'],
}

const tabla = new Map()
const cargar = (grupo, zona) => {
  for (const [partido, locs] of Object.entries(grupo)) {
    tabla.set(partido, { zona, partido })
    for (const l of locs) tabla.set(l, { zona, partido })
  }
}
cargar(PRIMER_CORDON, '1er cordón')
cargar(SEGUNDO_CORDON, '2do cordón')
cargar(TERCER_CORDON, '3er cordón')

const esCaba = (provincia, localidad) => {
  const p = norm(provincia), l = norm(localidad)
  return p.includes('capital federal') || p.includes('ciudad autonoma') || p === 'caba'
    || l === 'capital federal' || l === 'caba'
}

// Distancia en km al Obelisco (fallback cuando la localidad no está en la tabla)
const OBELISCO = { lat: -34.6037, lng: -58.3816 }
const km = (lat, lng) => {
  const R = 6371
  const dLat = (lat - OBELISCO.lat) * Math.PI / 180
  const dLng = (lng - OBELISCO.lng) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat * Math.PI / 180) * Math.cos(OBELISCO.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

/**
 * Devuelve { zona, partido, criterio } para una dirección de envío.
 * criterio: 'localidad' (salió de la tabla) | 'distancia' (estimado) | 'sin datos'
 */
export function cordonDe({ provincia, localidad, municipio, barrio, lat, lng }) {
  if (esCaba(provincia, localidad)) return { zona: 'CABA', partido: 'CABA', criterio: 'localidad' }

  for (const dato of [municipio, localidad, barrio]) {
    const hit = tabla.get(norm(dato))
    if (hit) return { ...hit, criterio: 'localidad' }
  }

  const enBsAs = norm(provincia).includes('buenos aires')
  if (lat != null && lng != null && Number.isFinite(+lat) && Number.isFinite(+lng)) {
    const d = km(+lat, +lng)
    if (d <= 12) return { zona: '1er cordón', partido: '', criterio: 'distancia' }
    if (d <= 25) return { zona: '2do cordón', partido: '', criterio: 'distancia' }
    if (d <= 60) return { zona: '3er cordón', partido: '', criterio: 'distancia' }
    return { zona: enBsAs ? 'Fuera del AMBA' : 'Interior', partido: '', criterio: 'distancia' }
  }

  return { zona: enBsAs ? 'Sin clasificar (Prov. Bs As)' : 'Interior', partido: '', criterio: 'sin datos' }
}

export default cordonDe
