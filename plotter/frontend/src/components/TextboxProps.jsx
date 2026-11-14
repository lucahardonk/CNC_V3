import { useEffect, useRef, useState } from 'react'
import { Bold, Italic, AlignLeft, AlignCenter, AlignRight } from 'lucide-react'
import { useStore } from '../store'
import { FONTS, ANCHORS, sheetKeyPoint, loadFont } from '../lib/textbox'
import { A4 } from '../lib/geometry'
import { NumInput } from './ui'

const STYLE_KEYS = ['font', 'size', 'anchor', 'align', 'italic', 'slant', 'bold', 'boldWidth', 'lineHeight', 'letterSpacing', 'rotation']

function Grid9({ value, onPick, title }) {
  return (
    <div className="grid w-[66px] grid-cols-3 gap-0.5" title={title}>
      {ANCHORS.map((a) => (
        <button key={a} onClick={() => onPick(a)}
          className={`h-5 w-5 rounded-sm border ${value === a ? 'border-accent bg-accent' : 'border-line bg-bg hover:border-gray-400'}`} />
      ))}
    </div>
  )
}

/** Editor della casella di testo: se `shape` è null modifica lo stile per le nuove caselle. */
export default function TextboxProps({ shape }) {
  const { updateShape, textStyle, setTextStyle, focusText, setFocusText } = useStore()
  const [margin, setMargin] = useState(10)
  const taRef = useRef(null)
  const v = shape || textStyle

  useEffect(() => {
    if (shape && focusText === shape.id) {
      setFocusText(null)
      // dopo il mouseup sul canvas, altrimenti il browser riprende il focus
      setTimeout(() => { taRef.current?.focus(); taRef.current?.select() }, 50)
    }
  }, [shape, focusText])
  useEffect(() => { if (v.font) loadFont(v.font) }, [v.font])

  const set = (patch, snap = true) => {
    const style = Object.fromEntries(Object.entries(patch).filter(([k]) => STYLE_KEYS.includes(k)))
    if (Object.keys(style).length) setTextStyle(style) // la prossima casella eredita lo stile
    if (shape) updateShape(shape.id, patch, snap)
  }
  // cambia ancora mantenendo ferma la posizione visiva del testo non serve: l'ancora È il punto di posizionamento
  const placeOnSheet = (a) => {
    const [x, y] = sheetKeyPoint(a, A4.w, A4.h, Number(margin) || 0)
    set({ anchor: a, x, y, align: a[1] === 'l' ? 'left' : a[1] === 'r' ? 'right' : 'center' })
  }
  const tb = (on) => `flex h-7 w-7 items-center justify-center rounded border ${on ? 'border-accent bg-accent/20 text-white' : 'border-line bg-bg-card text-gray-400 hover:text-white'}`

  return (
    <div className="space-y-2">
      <div className="label">{shape ? 'Casella di testo' : 'Stile nuove caselle di testo'}</div>
      {shape && (
        <textarea ref={taRef} className="input font-mono" rows={3} value={shape.text}
          onFocus={() => useStore.getState().snapshot()}
          onChange={(e) => set({ text: e.target.value }, false)} placeholder="Scrivi qui… (Invio = nuova riga)" />
      )}
      <select className="input py-1" value={v.font} onChange={(e) => set({ font: e.target.value })}>
        {FONTS.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
      </select>
      <div className="flex items-center gap-1">
        <label className="w-20 text-[11px] text-gray-500">Altezza mm<NumInput value={v.size} step={0.5} min={0.5} onChange={(x) => x !== '' && set({ size: x })} /></label>
        <div className="flex gap-1 pt-3.5">
          <button className={tb(v.bold)} title="Grassetto (più passate)" onClick={() => set({ bold: !v.bold })}><Bold size={14} /></button>
          <button className={tb(v.italic)} title="Corsivo (inclinazione)" onClick={() => set({ italic: !v.italic })}><Italic size={14} /></button>
          <span className="mx-0.5 w-px bg-line" />
          {[['left', AlignLeft], ['center', AlignCenter], ['right', AlignRight]].map(([a, I]) => (
            <button key={a} className={tb(v.align === a)} title={`Allinea ${a}`} onClick={() => set({ align: a })}><I size={14} /></button>
          ))}
        </div>
      </div>
      {(v.bold || v.italic) && (
        <div className="grid grid-cols-2 gap-2">
          {v.bold && <label className="text-[11px] text-gray-500">Spessore grassetto mm<NumInput value={v.boldWidth} step={0.05} min={0.05} onChange={(x) => x !== '' && set({ boldWidth: x })} /></label>}
          {v.italic && <label className="text-[11px] text-gray-500">Inclinazione °<NumInput value={v.slant} step={1} onChange={(x) => x !== '' && set({ slant: x })} /></label>}
        </div>
      )}
      <div className="grid grid-cols-3 gap-2">
        <label className="text-[11px] text-gray-500">Interlinea<NumInput value={v.lineHeight} step={0.1} min={0.5} onChange={(x) => x !== '' && set({ lineHeight: x })} /></label>
        <label className="text-[11px] text-gray-500">Spaziatura<NumInput value={v.letterSpacing} step={0.1} onChange={(x) => x !== '' && set({ letterSpacing: x })} /></label>
        <label className="text-[11px] text-gray-500">Rotazione °<NumInput value={v.rotation} step={5} onChange={(x) => x !== '' && set({ rotation: x })} /></label>
      </div>
      <div className="flex items-start gap-3 pt-1">
        <div>
          <div className="mb-1 text-[11px] text-gray-500">Punto di ancoraggio</div>
          <Grid9 value={v.anchor} onPick={(a) => set({ anchor: a })} title="Quale punto della casella sta sulle coordinate X/Y" />
        </div>
        {shape && (
          <div>
            <div className="mb-1 text-[11px] text-gray-500">Posiziona sul foglio</div>
            <div className="flex items-start gap-1.5">
              <Grid9 value={null} onPick={placeOnSheet} title="Allinea al punto chiave del foglio A4 (con margine)" />
              <label className="w-14 text-[10px] text-gray-500">margine<NumInput value={margin} step={1} min={0} onChange={setMargin} /></label>
            </div>
          </div>
        )}
      </div>
      {shape && (
        <div className="grid grid-cols-2 gap-2">
          <label className="text-[11px] text-gray-500">X ancora<NumInput value={+shape.x.toFixed(3)} onChange={(x) => x !== '' && set({ x })} /></label>
          <label className="text-[11px] text-gray-500">Y ancora<NumInput value={+shape.y.toFixed(3)} onChange={(y) => y !== '' && set({ y })} /></label>
        </div>
      )}
    </div>
  )
}
