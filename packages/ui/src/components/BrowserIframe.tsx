import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { ArrowLeft, ArrowRight, RotateCw, ExternalLink } from 'lucide-react'

interface Props {
	src: string
	className?: string
}

function isEditableTarget(target: EventTarget | null): boolean {
	if (!(target instanceof Element)) return false
	const tag = target.tagName
	if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
	return (target as HTMLElement).isContentEditable
}

export function BrowserIframe({ src, className }: Props) {
	const iframeRef = useRef<HTMLIFrameElement>(null)
	const [currentUrl, setCurrentUrl] = useState(src)
	const [inputUrl, setInputUrl] = useState(src)

	useEffect(() => {
		setCurrentUrl(src)
		setInputUrl(src)
	}, [src])

	useEffect(() => {
		setInputUrl(currentUrl)
	}, [currentUrl])

	const back = () => { try { iframeRef.current?.contentWindow?.history.back() } catch {} }
	const forward = () => { try { iframeRef.current?.contentWindow?.history.forward() } catch {} }
	const reload = () => {
		try { iframeRef.current?.contentWindow?.location.reload() }
		catch { if (iframeRef.current) iframeRef.current.src = iframeRef.current.src }
	}
	const openExternal = () => { window.open(currentUrl, '_blank') }
	const navigate = (url: string) => {
		if (iframeRef.current) iframeRef.current.src = url
	}

	// Shared shortcut handler. Used from both the parent wrapper (when focus is
	// on the chrome bar) and from inside the iframe contentWindow (when focus is
	// on the embedded app). `allowBackspace` is false for editable fields.
	const handleShortcut = (e: KeyboardEvent | ReactKeyboardEvent, allowBackspace: boolean): boolean => {
		// Reload: F5 or Ctrl/Cmd+R
		if (e.key === 'F5' || ((e.ctrlKey || e.metaKey) && (e.key === 'r' || e.key === 'R'))) {
			reload()
			return true
		}
		// Back / Forward: Alt+Left / Alt+Right
		if (e.altKey && e.key === 'ArrowLeft') { back(); return true }
		if (e.altKey && e.key === 'ArrowRight') { forward(); return true }
		// Backspace → back, but only outside editable fields
		if (allowBackspace && e.key === 'Backspace' && !e.ctrlKey && !e.metaKey && !e.altKey) {
			back()
			return true
		}
		return false
	}

	// Monkey-patch pushState/replaceState on each load so SPA navigations
	// (which don't fire any native event) bubble up as 'urlchange'. Also wire
	// keyboard shortcuts against the iframe document so they work while the
	// user is interacting with the embedded app.
	const handleLoad = () => {
		const iframe = iframeRef.current
		if (!iframe) return
		try {
			const w = iframe.contentWindow as (Window & { __browserChromePatched?: boolean }) | null
			if (!w) return
			setCurrentUrl(w.location.href)

			if (!w.__browserChromePatched) {
				const origPush = w.history.pushState
				const origReplace = w.history.replaceState
				w.history.pushState = function (...args: Parameters<typeof origPush>) {
					const r = origPush.apply(this, args)
					w.dispatchEvent(new Event('urlchange'))
					return r
				}
				w.history.replaceState = function (...args: Parameters<typeof origReplace>) {
					const r = origReplace.apply(this, args)
					w.dispatchEvent(new Event('urlchange'))
					return r
				}
				w.__browserChromePatched = true
			}

			const sync = () => {
				try { setCurrentUrl(w.location.href) } catch {}
			}
			w.addEventListener('popstate', sync)
			w.addEventListener('urlchange', sync)
			w.addEventListener('hashchange', sync)

			const onIframeKeyDown = (e: KeyboardEvent) => {
				const handled = handleShortcut(e, !isEditableTarget(e.target))
				if (handled) {
					e.preventDefault()
					e.stopPropagation()
				}
			}
			w.addEventListener('keydown', onIframeKeyDown, true)
		} catch {
			// cross-origin: can't introspect, keep current url as-is
		}
	}

	const onSubmit = (e: FormEvent) => {
		e.preventDefault()
		navigate(inputUrl)
	}

	const onWrapperKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
		const handled = handleShortcut(e, !isEditableTarget(e.target))
		if (handled) {
			e.preventDefault()
			e.stopPropagation()
		}
	}

	return (
		<div className={`browser-iframe ${className || ''}`} onKeyDown={onWrapperKeyDown}>
			<div className="browser-chrome">
				<button type="button" className="browser-btn" title="Back (Alt+←, Backspace)" onClick={back}>
					<ArrowLeft size={16} />
				</button>
				<button type="button" className="browser-btn" title="Forward (Alt+→)" onClick={forward}>
					<ArrowRight size={16} />
				</button>
				<button type="button" className="browser-btn" title="Reload (F5, Ctrl+R)" onClick={reload}>
					<RotateCw size={16} />
				</button>
				<form className="browser-url-form" onSubmit={onSubmit}>
					<input
						className="browser-url"
						value={inputUrl}
						onChange={(e) => setInputUrl(e.target.value)}
						spellCheck={false}
					/>
				</form>
				<button type="button" className="browser-btn" title="Open in new tab" onClick={openExternal}>
					<ExternalLink size={16} />
				</button>
			</div>
			<iframe ref={iframeRef} className="browser-frame" src={src} onLoad={handleLoad} />
		</div>
	)
}
