import React, { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ExperienceEditor, HeaderEditor, makeMutators, newestExperienceOrder } from '../screens/ResumeSections'

afterEach(cleanup)

it('persists header fields when an imported resume has no header', () => {
  const saved = vi.fn()
  function Editor() {
    const [data, setData] = useState({ summary: 'Existing text' })
    return <HeaderEditor data={data} {...makeMutators(data, (value) => { setData(value); saved(value) })} />
  }
  render(<Editor />)
  fireEvent.change(screen.getByRole('textbox', { name: 'Full name' }), { target: { value: 'Sample Name' } })
  fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), { target: { value: 'Director of Analytics' } })
  expect(saved).toHaveBeenLastCalledWith({
    header: { name: 'Sample Name', title: 'Director of Analytics' }, summary: 'Existing text',
  })
})

it('sorts ongoing and recently ended roles ahead of older and undated roles', () => {
  const dates = ['', '2010-2014', 'Mar 2023 – Present', '07/2019 to 2024-09', 'Jan 2025-Present', 'Undated']
  expect(newestExperienceOrder(dates.map((date) => ({ date })))).toEqual([4, 2, 3, 1, 0, 5])
})

it('sorts, moves and edits experience through the same save path', () => {
  const saved = vi.fn()
  const older = { title: 'Older role', company: 'Example', date: '2010 – 2020', bullets: [] }
  const newer = { title: 'Newer role', company: 'Example', date: 'Feb 2024 – Present', bullets: [] }
  function Editor() {
    const [data, setData] = useState({ experience: [older, newer] })
    return <ExperienceEditor data={data} {...makeMutators(data, (value) => { setData(value); saved(value) })} />
  }
  render(<Editor />)
  fireEvent.click(screen.getByRole('button', { name: 'Sort newest first' }))
  expect(saved).toHaveBeenLastCalledWith({ experience: [newer, older] })
  fireEvent.click(screen.getByTitle('Move up'))
  expect(saved).toHaveBeenLastCalledWith({ experience: [older, newer] })
  fireEvent.change(screen.getByRole('textbox', { name: 'Date' }), { target: { value: '2011 – 2020' } })
  expect(saved).toHaveBeenLastCalledWith({ experience: [{ ...older, date: '2011 – 2020' }, newer] })
})
