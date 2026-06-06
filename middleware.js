export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/wa).*)']
};

export default function middleware(request) {
  const password = process.env.SITE_PASSWORD || '';

  // Fail-open: si no se configuro SITE_PASSWORD el sitio queda publico
  // pero funcional. Para activar privacidad, setear la variable en Vercel.
  if (!password) return;

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
