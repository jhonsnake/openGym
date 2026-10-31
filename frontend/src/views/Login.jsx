import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { api, webauthnOK, passkeyLogin, passkeyRegister, passkeyError, bio } from '../lib/api.js'
import { hasData } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { DEMO, REPO } from '../lib/demo.js'
import { guestAllowed } from '../lib/guest.js'
import { managedModeHint } from '../lib/managed-bridge.js'
import { clearInvitation, updateInvitation } from '../lib/invitation-receiver.js'
import { InvitationConsent, useInvitation, validInvitationPreview } from '../components/InvitationFlow.jsx'
import { useState, useRef, useEffect } from 'react'
import Icon from '../components/Icon.jsx'
import { Button, Segmented } from '../components/ui.jsx'
import { askAddDeviceData } from '../sheets.jsx'
import { passwordOn, PasswordRegisterForm, openPasswordSignIn } from '../components/PasswordAuth.jsx'
import { openDeviceLinkRedeem } from '../components/Passkeys.jsx'
import { openLostAccess } from '../components/LostAccess.jsx'

const managedInvitationToken = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value)

function RegisterSheet({ close, inviteToken = null, onInvitationRegistered }) {
  const { setUser, pushState, pullState, loadConfig } = useStore()
  const config = useStore(s => s.config)
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const inviteOnly = !!config?.invite_only
  const managedInvitation = managedInvitationToken(inviteToken)
  // A password is offered only where the instance allows it (#118), and is the only choice in a
  // browser that cannot make a passkey. Where both work, the passkey stays the first one.
  const pwOn = passwordOn(config)
  const [how, setHow] = useState(webauthnOK() ? 'passkey' : 'password')
  const ref = useRef(null)
  useEffect(() => { setTimeout(() => ref.current?.focus(), 250) }, [])
  // Boot already fetched this; retry here only if that attempt failed, so the invite field still
  // appears on an instance whose config arrived late rather than never.
  useEffect(() => { loadConfig() }, [loadConfig])
  const go = async () => {
    const n = name.trim()
    if (!n) { useUI.getState().toast(t('Enter a name')); return }
    if (inviteOnly && !managedInvitation && !code.trim()) { useUI.getState().toast(t('An invite code is required')); return }
    try {
      const u = await passkeyRegister(n, code.trim(), managedInvitation ? inviteToken : undefined)
      setUser(u); close()
      if (managedInvitation) {
        onInvitationRegistered?.()
        useUI.getState().toast(t('Your passkey was created. Your operational role, trainer confirmation, and renewal status remain pending.'))
        return
      }
      if (hasData(useStore.getState().S)) { await pushState(); useUI.getState().toast(t('Profile created, and this device’s data moved into it')) }
      else { await pullState(); useUI.getState().toast(t('Welcome, {0}', u.name)) }
    } catch (e) { if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') useUI.getState().toast(passkeyError(e, t('Registration failed'))) }
  }
  const choose = pwOn && webauthnOK() && <>
    <Segmented options={[{ value: 'passkey', label: t('Passkey'), icon: 'fingerprint' }, { value: 'password', label: t('Password'), icon: 'key' }]}
      value={how} onChange={setHow} />
    <div style={{ height: 12 }} />
  </>
  if (pwOn && how === 'password') return <>
    <h3>{t('Create your profile')}</h3>
    {choose}
    <div className="muted small" style={{ marginBottom: 14 }}>{t('Pick a name and a password. You sign in with both.')}</div>
    <PasswordRegisterForm close={close} inviteOnly={inviteOnly} inviteToken={managedInvitation ? inviteToken : undefined} onInvitationRegistered={onInvitationRegistered} name={name} setName={setName} code={code} setCode={setCode} />
  </>
  return <>
    <h3>{t('Create your profile')}</h3>
    {choose}
    <div className="muted small" style={{ marginBottom: 14 }}>{t('Pick a name, then confirm with {0}. The passkey lives on your device, so no password needed.', bio())}</div>
    <input ref={ref} className="input" placeholder={t('Your name')} maxLength={40} value={name} onChange={e => setName(e.target.value)} />
    {inviteOnly && !managedInvitation && <>
      <div style={{ height: 10 }} />
      <input className="input" placeholder={t('Invite code')} maxLength={40} value={code}
        onChange={e => setCode(e.target.value.toUpperCase())} style={{ letterSpacing: '.14em', fontWeight: 600, textAlign: 'center' }} />
      <div className="dim small" style={{ marginTop: 6 }}>{t('This app is invite-only. Enter the code you were given.')}</div>
    </>}
    {managedInvitation && <div className="dim small" style={{ marginTop: 10 }}>{t('This managed invitation securely replaces the traditional invite code. You will return to the invitation steps after creating your profile.')}</div>}
    <div style={{ height: 12 }} />
    <Button variant="primary" onClick={go}>{t('Create passkey')}</Button>
  </>
}

export default function Login() {
  const { setUser, adoptProfile, setGuest } = useStore()
  const config = useStore(s => s.config)
  const invitation = useInvitation()
  const inviteToken = invitation?.token || null
  const [preview, setPreview] = useState(() => invitation?.preview ? { kind: 'ready', value: invitation.preview } : { kind: inviteToken ? 'loading' : 'none', value: null })
  const canGuest = guestAllowed(config, { managedHint: managedModeHint() })
  const managedInviteRequired = config?.managed_subscriptions === true || managedModeHint()
  const pwOn = passwordOn(config)
  useEffect(() => {
    if (!inviteToken) return
    let alive = true
    api('/api/invitations/preview', { method: 'POST', body: JSON.stringify({ token: inviteToken }) })
      .then(value => {
        if (!alive || !validInvitationPreview(value)) return alive && setPreview({ kind: 'invalid', value: null })
        updateInvitation({ preview: JSON.parse(JSON.stringify(value)) })
        setPreview({ kind: 'ready', value })
      })
      .catch(() => { if (alive) setPreview({ kind: 'invalid', value: null }) })
    return () => { alive = false }
  }, [inviteToken])
  const inviteReady = preview.kind === 'ready' && invitation?.consent === true && (invitation?.selected?.length || 0) > 0
  const register = () => {
    if (!inviteToken && managedInviteRequired) { useUI.getState().toast(t('An invitation is required to create a managed profile.')); return }
    if (inviteToken && !inviteReady) return
    useUI.getState().openSheet(close => <RegisterSheet close={close} inviteToken={inviteToken} onInvitationRegistered={() => {}} />)
  }
  const signIn = async () => {
    try { const u = await passkeyLogin(); setUser(u, managedInviteRequired ? undefined : { adopt: true }); if (!managedInviteRequired) await adoptProfile(askAddDeviceData); useUI.getState().toast(t('Welcome back, {0}', u.name)) }
    catch (e) { if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') useUI.getState().toast(passkeyError(e, t('Sign-in failed'))) }
  }
  const head = <><h1 className="wordmark">John<span>Gym</span></h1></>
  const wrap = { display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: '78vh', textAlign: 'center' }

  // Demo build: no backend to sign in against — the only way in is the local guest profile.
  if (DEMO) return (
    <div className="narrow" style={wrap}>
      {head}
      <div className="muted" style={{ marginBottom: 30 }}>{t('Live demo. Everything stays in this browser.')}</div>
      <Button variant="primary" icon="play" onClick={() => setGuest(true)}>{t('Start the demo')}</Button>
      <div className="card small muted" style={{ textAlign: 'start', marginTop: 16 }}>
        {t('This demo runs entirely in your browser on example data. Nothing is sent anywhere. Passkey sign-in and sync across your devices come with the openGym server, which you get by self-hosting it.')}
      </div>
      <div className="dim small" style={{ marginTop: 22, lineHeight: 1.6 }}>
        <a href={REPO} target="_blank" rel="noopener">{t('Self-host it in a minute →')}</a>
      </div>
    </div>
  )

  return (
    <div className="narrow" style={wrap}>
      {head}
      <div className="muted" style={{ marginBottom: 34 }}>{t('Your workouts. Your weights. Your profile.')}</div>
      {!inviteToken && managedInviteRequired && <p role="alert" className="muted">{t('An invitation is required to create a managed profile.')}</p>}
      {inviteToken && <section className="card small" data-invitation-consent="true" style={{ textAlign: 'start', marginBottom: 18 }}>
        <h2>{t('Training invitation')}</h2>
        {preview.kind === 'loading' && <p aria-live="polite">{t('Loading invitation details…')}</p>}
        {preview.kind === 'invalid' && <p role="alert">{t('This invitation is unavailable. Ask the trainer for a new link.')}</p>}
        {preview.kind === 'ready' && <>
          <p>{preview.value.purpose} · {t('expires')} {new Date(preview.value.expiresAt).toLocaleString()}</p>
          <p className="muted">{t('Choose exactly what you consent to. Creating a passkey does not grant a client role, a paid subscription, or a confirmed training relationship.')}</p>
          <InvitationConsent preview={preview.value} compact />
          <p className="muted">{t('A new account remains pending for the operational role and trainer confirmation. Renewal is separate and does not activate a relationship automatically.')}</p>
          {!Number.isSafeInteger(preview.value.invitationVersion) && <p role="alert">{t('The server did not publish the current invitation version required to accept or reject it. Your account and choices were not changed.')}</p>}
        </>}
        <button className="btn ghost" type="button" onClick={() => { clearInvitation(); setPreview({ kind: 'none', value: null }) }}>{t('Cancel invitation')}</button>
      </section>}
      {webauthnOK() ? <>
        <Button variant="primary" icon="fingerprint" onClick={signIn}>{t('Sign in with passkey')}</Button>
        <div style={{ height: 10 }} />
        {pwOn && <><Button icon="key" onClick={() => openPasswordSignIn()}>{t('Sign in with password')}</Button><div style={{ height: 10 }} /></>}
        <Button icon="plusCircle" disabled={(!inviteToken && managedInviteRequired) || (!!inviteToken && !inviteReady)} onClick={register}>{t('Create new profile')}</Button>
        {/* Already signed in on another device: a code from there gives this one a passkey of
            its own (#95), instead of a new, empty profile. */}
        <div style={{ height: 10 }} />
        <Button variant="ghost" className="dim" icon="qr" onClick={openDeviceLinkRedeem}>{t('Use a code from your other device')}</Button>
        {/* No device signs you in any more (#584): what to try, and where a recovery code goes. */}
        <Button variant="ghost" className="dim" onClick={openLostAccess}>{t('Lost access?')}</Button>
        {canGuest && <div style={{ height: 4 }} />}
      </> : pwOn ? <>
        {/* Plain http on a LAN address, or a browser without passkey support: the password is
            the way in, and the only way to create a profile from here. */}
        <div className="card small muted" style={{ textAlign: 'start', marginBottom: 14 }}>{t("This browser doesn't support passkeys. Sign in with your name and password instead.")}</div>
        <Button variant="primary" icon="key" onClick={() => openPasswordSignIn()}>{t('Sign in with password')}</Button>
        <div style={{ height: 10 }} />
        <Button icon="plusCircle" disabled={!!inviteToken && !inviteReady} onClick={register}>{t('Create new profile')}</Button>
        <Button variant="ghost" className="dim" onClick={openLostAccess}>{t('Lost access?')}</Button>
        {canGuest && <div style={{ height: 10 }} />}
      </> : <div className="card small muted" style={{ textAlign: 'start' }}>{canGuest
        ? t("This browser doesn't do passkeys, but you can still use openGym locally on this device.")
        // Without passkeys and without the guest entrance there is no way in from this browser,
        // so say that plainly instead of offering a local profile that cannot be created.
        : t("This browser doesn't support passkeys, and this instance requires an account. Try a browser or device with passkey support.")}</div>}
      {canGuest && <Button variant="ghost" className="dim" onClick={() => setGuest(true)}>{t('Continue without account')}</Button>}
      <div className="dim small" style={{ marginTop: 26, lineHeight: 1.5 }}>{pwOn ? t('Passkeys use {0}. A password works too, where passkeys do not.', bio()) : t('Passkeys use {0}. No passwords to remember.', bio())}<br />{t('Each profile keeps its own plan, workouts & body weight.')}</div>
    </div>
  )
}
