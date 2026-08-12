import React from 'react';
import { View, ViewStyle, StyleProp } from 'react-native';
import { useResponsive } from '@/lib/useResponsive';
import { cn } from '@/lib/cn';

interface ResponsiveContainerProps {
  children: React.ReactNode;
  /** Additional className for NativeWind styling */
  className?: string;
  /** Additional inline styles */
  style?: StyleProp<ViewStyle>;
  /** Whether to center content horizontally on larger screens */
  centered?: boolean;
  /** Maximum width constraint (overrides auto calculation) */
  maxWidth?: number;
  /** Horizontal padding mode */
  padding?: 'none' | 'sm' | 'md' | 'lg' | 'responsive';
  /** Enable flex-1 to fill available space */
  flex?: boolean;
}

/**
 * ResponsiveContainer - Wraps content with responsive constraints
 *
 * On phones: Full width with appropriate padding
 * On tablets: Centered with max-width constraint for better readability
 *
 * Usage:
 * <ResponsiveContainer padding="md" centered>
 *   <YourContent />
 * </ResponsiveContainer>
 */
export function ResponsiveContainer({
  children,
  className,
  style,
  centered = true,
  maxWidth,
  padding = 'responsive',
  flex = false,
}: ResponsiveContainerProps) {
  const { width, isTablet, maxContentWidth, rs } = useResponsive();

  // Calculate effective max width
  const effectiveMaxWidth = maxWidth ?? maxContentWidth;

  // Calculate padding based on mode
  const getPadding = (): number => {
    switch (padding) {
      case 'none':
        return 0;
      case 'sm':
        return rs(8);
      case 'md':
        return rs(16);
      case 'lg':
        return rs(24);
      case 'responsive':
      default:
        // More padding on larger screens
        return isTablet ? rs(24) : rs(16);
    }
  };

  const horizontalPadding = getPadding();

  // On tablets with centered layout, add horizontal margins
  const shouldCenter = centered && isTablet && width > effectiveMaxWidth;

  const containerStyle: ViewStyle = {
    width: '100%',
    maxWidth: shouldCenter ? effectiveMaxWidth : undefined,
    alignSelf: shouldCenter ? 'center' : undefined,
    paddingHorizontal: horizontalPadding,
    ...(flex ? { flex: 1 } : {}),
  };

  return (
    <View
      className={cn(className)}
      style={[containerStyle, style]}
    >
      {children}
    </View>
  );
}

interface ResponsiveRowProps {
  children: React.ReactNode;
  className?: string;
  style?: StyleProp<ViewStyle>;
  /** Gap between items */
  gap?: number;
  /** Wrap items on smaller screens */
  wrap?: boolean;
  /** Stack vertically on phones, horizontal on tablets */
  stackOnPhone?: boolean;
}

/**
 * ResponsiveRow - Horizontal row that can adapt to screen size
 *
 * Can automatically stack items vertically on smaller screens
 */
export function ResponsiveRow({
  children,
  className,
  style,
  gap = 8,
  wrap = false,
  stackOnPhone = false,
}: ResponsiveRowProps) {
  const { isPhone, rs } = useResponsive();

  const shouldStack = stackOnPhone && isPhone;
  const scaledGap = rs(gap);

  const rowStyle: ViewStyle = {
    flexDirection: shouldStack ? 'column' : 'row',
    flexWrap: wrap ? 'wrap' : 'nowrap',
    gap: scaledGap,
  };

  return (
    <View className={cn(className)} style={[rowStyle, style]}>
      {children}
    </View>
  );
}

interface ResponsiveGridProps {
  children: React.ReactNode;
  className?: string;
  style?: StyleProp<ViewStyle>;
  /** Number of columns on phones (default: 1) */
  phoneCols?: 1 | 2 | 3;
  /** Number of columns on tablets (default: 2) */
  tabletCols?: 1 | 2 | 3 | 4;
  /** Gap between items */
  gap?: number;
}

/**
 * ResponsiveGrid - Grid layout that adjusts columns based on screen size
 */
export function ResponsiveGrid({
  children,
  className,
  style,
  phoneCols = 1,
  tabletCols = 2,
  gap = 12,
}: ResponsiveGridProps) {
  const { isTablet, rs, width, maxContentWidth } = useResponsive();

  const columns = isTablet ? tabletCols : phoneCols;
  const scaledGap = rs(gap);

  // Calculate item width based on columns and gap
  const containerWidth = isTablet ? Math.min(width, maxContentWidth) : width;
  const totalGapWidth = (columns - 1) * scaledGap;
  const itemWidth = (containerWidth - totalGapWidth - rs(32)) / columns; // subtract padding

  const childrenArray = React.Children.toArray(children);

  return (
    <View
      className={cn(className)}
      style={[
        {
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: scaledGap,
        },
        style,
      ]}
    >
      {childrenArray.map((child, index) => (
        <View key={index} style={{ width: itemWidth }}>
          {child}
        </View>
      ))}
    </View>
  );
}

interface ResponsiveTextProps {
  /** Base font size (will be scaled) */
  size?: 'xs' | 'sm' | 'base' | 'lg' | 'xl' | '2xl' | '3xl';
  /** Make text larger on tablets */
  scaleOnTablet?: boolean;
}

/**
 * Helper to get responsive font size class
 */
export function getResponsiveFontClass(
  baseSize: ResponsiveTextProps['size'] = 'base',
  isTablet: boolean,
  scaleOnTablet: boolean = true
): string {
  const sizeMap = {
    xs: 'text-xs',
    sm: 'text-sm',
    base: 'text-base',
    lg: 'text-lg',
    xl: 'text-xl',
    '2xl': 'text-2xl',
    '3xl': 'text-3xl',
  };

  const tabletSizeMap = {
    xs: 'text-sm',
    sm: 'text-base',
    base: 'text-lg',
    lg: 'text-xl',
    xl: 'text-2xl',
    '2xl': 'text-3xl',
    '3xl': 'text-4xl',
  };

  if (isTablet && scaleOnTablet) {
    return tabletSizeMap[baseSize];
  }

  return sizeMap[baseSize];
}

export default ResponsiveContainer;
