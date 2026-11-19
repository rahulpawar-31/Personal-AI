// The public origins of this repository's hosted deployment. Keep this pairing
// explicit: request Host/forwarded headers must never grant OAuth trust.
export const hostedDeployment = Object.freeze({
  apiOrigin: 'https://personal-ai-f2f9.onrender.com',
  frontendOrigin: 'https://personal-ai-blue.vercel.app',
});
