# Performance Optimizations

## Overview
Implemented aggressive code splitting and lazy loading to reduce initial bundle size and improve page load time. The app now loads only what's needed for the current page.

## Key Changes

### 1. **Code Splitting by Feature**
   - **Lazy Loading All Pages**: Converted eager imports of Landing and Feed pages to lazy loading using `React.lazy()` in `src/App.tsx`
   - **Route-Based Chunks**: Each page is now a separate chunk, loaded only when the user navigates to that route
   - **Vendor Chunks**: Split vendor dependencies into separate chunks:
     - `vendor-react`: React & React DOM (174 KB gzip)
     - `vendor-radix`: Radix UI components (128 KB gzip)
     - `vendor-query`: React Query (41 KB gzip)
     - `vendor-auth`: Better Auth (27 KB gzip)
     - `vendor-date`: date-fns utilities (10 KB gzip)
     - `vendor-motion`: Framer Motion (117 KB gzip) - lazy loaded!
     - `vendor-charts`: Recharts (included in main for now)

### 2. **Lazy Loading Framer Motion**
   - Wrapped framer-motion in `React.lazy()` to defer loading until needed
   - Created fallback div component in `src/components/civic/Motion.tsx`
   - Only used in ReferenceCard and RightsArticle components
   - Saves 117 KB from initial bundle (avoids loading if user doesn't view these components)

### 3. **Font Loading Optimization**
   - **Critical Font (Public Sans)**: Loaded immediately with `display=swap` (used for all text)
   - **Non-Critical Fonts**: Fraunces and IBM Plex Mono deferred with `display=optional`
   - Fonts load asynchronously without blocking page render
   - Prevents invisible text flash while fonts load

### 4. **Vite Build Configuration** (`vite.config.ts`)
   - Implemented `manualChunks` function to intelligently split vendor code
   - Each vendor dependency group is isolated into its own chunk
   - Chunks load in parallel, improving overall load time
   - Main app chunk (~85 KB gzip) contains only app-specific code

## Performance Impact

### Before Optimizations
- Single large vendor bundle (~750 KB before optimization)
- All page components loaded upfront
- Framer Motion loaded even if user never views animated components
- All fonts block render

### After Optimizations
- **Parallel Chunk Loading**: Vendor chunks load in parallel
- **Lazy Route Loading**: Pages load only when navigated to
- **Motion Chunk Deferred**: 117 KB motion library only loads when needed
- **Optimized Fonts**: Critical path fonts load without blocking
- **Initial Bundle**: Main app chunk is smaller, loads faster
- **Network**: Multiple smaller chunks use better caching and parallel downloads

## How It Works

1. **Initial Load** (`/`):
   - Load: React, React Router, React Query, Radix UI, auth
   - Defer: Framer Motion, page components, non-critical fonts
   - User sees Landing page quickly while other chunks load in background

2. **Navigate to Feed** (`/feed`):
   - Load: Feed page component
   - Also loads: Feed-specific components (ComposeCard, PostCard, etc.)
   - Vendor chunks already cached from initial load

3. **Navigate to Library** (`/library`):
   - Load: Library page component
   - Vendor chunks already cached

4. **View Animated Components**:
   - When ReferenceCard or RightsArticle renders
   - Framer Motion chunk loads on-demand
   - Suspense boundary shows content while loading

## Browser Caching
- Vendor chunks have stable hashes, cached long-term
- App chunks update when code changes
- Only changed chunks re-downloaded on updates

## Testing
Run `bun run build` to see bundle analysis. Current production build:
- **index.html**: 2.4 KB (gzip: 0.95 KB)
- **CSS**: 81 KB (gzip: 13.81 KB)
- **Main App**: 85 KB (gzip: 26.56 KB)
- **Vendor React**: 174 KB (gzip: 57.21 KB)
- **Vendor Radix**: 128 KB (gzip: 39.80 KB)
- **Vendor Query**: 41 KB (gzip: 12.33 KB)
- **Vendor Motion**: 117 KB (gzip: 38.79 KB) - only loads when needed

## Files Modified
1. `vite.config.ts` - Manual chunk splitting configuration
2. `src/App.tsx` - Lazy load Landing and Feed pages
3. `src/components/civic/Motion.tsx` - Lazy load Framer Motion
4. `src/index.css` - Optimize font import strategy
5. `index.html` - Defer non-critical fonts, preconnect to APIs
