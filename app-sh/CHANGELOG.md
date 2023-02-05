# app-sh

## 1.3.2

### Patch Changes

- Removed zod

## 1.3.1

### Patch Changes

- Minor tidy up of SseServer code

## 1.3.0

### Minor Changes

- Removed undici, added cors and general tidy up of HttpMan

## 1.2.1

### Patch Changes

- Removed dayjs and am using toLocaleString() and toISOString() to format now
- Changed plugin (stop(), version and config), changed httpMan (using zod.safeParse return value)

## 1.2.0

### Minor Changes

- Added HttpMan middlewares (body, json) and added the finally() method

## 1.1.1

### Patch Changes

- Now checking received body size

## 1.1.0

### Minor Changes

- Added Http Manager

## 1.0.0

### Major Changes

- Inital release of app-sh
