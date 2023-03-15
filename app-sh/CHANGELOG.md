# app-sh

## 1.5.0

### Minor Changes

- Moved so of the HTTP req message props to the actual req message

## 1.4.0

### Minor Changes

- Now suppressing error message if log level is COMPLETE_SILENCE

## 1.3.16

### Patch Changes

- Added getters to HttpMan to expose baseUrl and if HTTPS is enabled

## 1.3.15

### Patch Changes

- Added getters to HttpMan to expose port and IP it is listening on

## 1.3.14

### Patch Changes

- Clearing HttpMan and plugin lists on exit - this is in case you need to do a soft exit

## 1.3.13

### Patch Changes

- Export HttpServmerResponse

## 1.3.12

### Patch Changes

- Updated a couple types to use Record<string, any>

## 1.3.11

### Patch Changes

- Fixed exports in package.json

## 1.3.10

### Patch Changes

- Rolling up types now

## 1.3.9

### Patch Changes

- Updated min node engine requirement to 18

## 1.3.8

### Patch Changes

- Made question() static on AppShPlugin

## 1.3.7

### Patch Changes

- Made question() and static method

## 1.3.6

### Patch Changes

- Added question and addHttpMan to AppShPlugin

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
