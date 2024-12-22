import { next } from '@vercel/edge';

export default function middleware(req) {
  return next({
    headers: {
      'Cache-Control': 'max-age=86400',
    },
  });
}