# app-sh

## 1.3.5

### Patch Changes

- Made AppSh config optional

  Now will create an AppSh for the plugin if one is not provided

## 1.3.4

### Patch Changes

- Fixed issue where log level is not set

## 1.3.3

### Patch Changes

- - Added ability to add default middlewares when create a HttpManager
  - Can now create multiple HttpManagers
  - Now handling json, html and text returns type automatically

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
