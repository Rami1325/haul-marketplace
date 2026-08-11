import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

/**
 * Testing Library registers its own cleanup only when `afterEach` is a global,
 * and this project does not run Vitest with globals on. Without this line every
 * render in a file stacks up in the same `document.body`, and a `screen` query
 * starts matching an element the previous test left behind — which is the kind
 * of green that turns red the day somebody reorders two tests.
 */
afterEach(cleanup);
