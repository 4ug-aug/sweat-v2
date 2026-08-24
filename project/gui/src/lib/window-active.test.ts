import { expect, test } from 'bun:test'
import { windowIsActive } from './window-active'

test('a hidden document is never active', () => {
  expect(
    windowIsActive({
      visibilityState: 'hidden',
      documentFocused: true,
      tauriFocused: true,
    }),
  ).toBe(false)
})

test('an unfocused document is inactive when Tauri has not reported focus', () => {
  expect(
    windowIsActive({
      visibilityState: 'visible',
      documentFocused: false,
    }),
  ).toBe(false)
})

test('a focused visible document is active', () => {
  expect(
    windowIsActive({
      visibilityState: 'visible',
      documentFocused: true,
    }),
  ).toBe(true)
})

test('an unfocused Tauri window is inactive even if the document still reports focus', () => {
  expect(
    windowIsActive({
      visibilityState: 'visible',
      documentFocused: true,
      tauriFocused: false,
    }),
  ).toBe(false)
})

test('a focused Tauri window is active even if the document has not updated yet', () => {
  expect(
    windowIsActive({
      visibilityState: 'visible',
      documentFocused: false,
      tauriFocused: true,
    }),
  ).toBe(true)
})
