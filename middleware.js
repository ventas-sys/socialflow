export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)']
};

export default function middleware(request) {
  const url = new URL(request.url);
  const password = process.env.SITE_PASSWORD || '';

  if (!password) {
    return new Response(
      'Sitio privado mal configurado: falta SITE_PASSWORD en variables de entorno de Vercel.',
      { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
    );
  }

  const auth = request.headers.get('authorization') || '';
  if (auth.startsWith('Basic ')) {
    const decoded = atob(auth.slice(6));
    const [user, pass] = decoded.split(':');
    if (pass === password && (user === 'uniproveedores' || user === 'admin' || user === '')) {
      return;
    }
  }

  return new Response('Acceso restringido. Sitio privado de Uniproveedores.', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="Uniproveedores Agencia", charset="UTF-8"',
      'Content-Type': 'text/plain; charset=utf-8'
    }
  });
}
