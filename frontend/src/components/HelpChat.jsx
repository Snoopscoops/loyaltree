import React, { useEffect, useMemo, useRef, useState } from 'react'

/**
 * Loyalty Tree Help Assistant V2
 * --------------------------------
 * Non-AI, zero-token help system.
 *
 * Primary experience:
 *  - User clicks the floating Help button
 *  - Initial FAQ buttons appear immediately
 *  - Clicking a FAQ shows the prepared step-by-step answer
 *  - Typing remains available as a fallback
 *
 * No backend/API call is required.
 */

const HELP_ARTICLES = [
  {
    id: 'scan-to-join',
    roles: ['owner', 'manager'],
    category: 'Customers',
    title: 'How does Scan to Join work?',
    shortLabel: 'How does Scan to Join work?',
    keywords: [
      'scan to join', 'join qr', 'customer join', 'register customer',
      'customer registration', 'new customer', 'sumali', 'mag join',
      'paano sumali', 'paano mag join', 'registration qr', 'wallet join'
    ],
    answer: [
      'Show the business Join QR to the customer.',
      'The customer scans the QR using their phone camera.',
      'They complete the registration form.',
      'After registration, they add the Loyalty Tree card to Apple Wallet or Google Wallet.',
      'Once the card is saved, they can present it on future visits.'
    ],
    note: 'Scan to Join is for customers joining the loyalty program. It is different from Scan to Stamp.'
  },
  {
    id: 'share-join-qr',
    roles: ['owner'],
    category: 'Customers',
    title: 'How do I show or share our Join QR?',
    shortLabel: 'How do I share our Join QR?',
    keywords: [
      'share qr', 'join qr', 'download qr', 'customer qr',
      'show qr', 'join link', 'share join link', 'scan to join qr'
    ],
    answer: [
      'Open your Loyalty Tree Owner Dashboard.',
      'Choose the loyalty program you want customers to join.',
      'Open the Join QR / Share Your Tree action.',
      'Show the QR on-screen, share it, or download it for printing.',
      'Customers use this QR only for joining the program.'
    ],
    note: 'If your business has multiple programs, select the correct program before sharing its Join QR.'
  },
  {
    id: 'scan-to-stamp',
    roles: ['owner', 'manager'],
    category: 'Transactions',
    title: 'How do we Scan to Stamp?',
    shortLabel: 'How do we Scan to Stamp?',
    keywords: [
      'scan to stamp', 'scan customer', 'scan card', 'stamp customer',
      'add stamp', 'dagdag stamp', 'mag stamp', 'paano mag stamp',
      'customer qr', 'wallet scan', 'record visit', 'visit stamp'
    ],
    answer: [
      'Open the Loyalty Tree scanner used by the staff or cashier.',
      'Ask the customer to open their Loyalty Tree card in Apple Wallet or Google Wallet.',
      'Scan the QR shown on the customer card.',
      'Check that the correct customer and loyalty program appear.',
      'Confirm the transaction according to the loyalty program rules.'
    ],
    note: 'Scan to Stamp is for returning customers. The exact transaction screen depends on the card type.'
  },
  {
    id: 'owner-points-stamps',
    roles: ['owner'],
    category: 'Customers',
    title: 'How do I correct a customer’s points or stamps?',
    shortLabel: 'How do I correct points or stamps?',
    keywords: [
      'points', 'add points', 'dagdag points', 'customer points',
      'edit points', 'adjust points', 'wrong points', 'kulang points',
      'edit stamps', 'adjust stamps', 'customer stamps', 'manual correction'
    ],
    answer: [
      'Open the customer from the Owner Dashboard.',
      'Use Edit Customer or the available customer balance controls.',
      'Change only the balance that belongs to that customer’s current card type.',
      'Save the correction.',
      'Re-open or refresh the customer to confirm that the updated balance was recorded.'
    ],
    note: 'Manual corrections should only be used when needed. Normal customer activity should still go through the scanner/transaction flow.'
  },
  {
    id: 'manager-points',
    roles: ['manager'],
    category: 'Customers',
    title: 'How do I correct customer points?',
    shortLabel: 'How do I correct customer points?',
    keywords: [
      'manager points', 'correct points', 'adjust points', 'edit points',
      'wrong points', 'customer points', 'save points', 'points correction'
    ],
    answer: [
      'Open the Members section in the Branch Manager Dashboard.',
      'Search for the customer.',
      'Enter the corrected value under Reward Points.',
      'Press Save points.',
      'Enter the reason for the manual adjustment when prompted.'
    ],
    note: 'The manager correction is recorded with the manager, branch, before/after values, date/time, and reason.'
  },
  {
    id: 'manager-stamps',
    roles: ['manager'],
    category: 'Customers',
    title: 'How do I correct customer stamps?',
    shortLabel: 'How do I correct customer stamps?',
    keywords: [
      'manager stamps', 'correct stamps', 'adjust stamps', 'edit stamps',
      'wrong stamps', 'customer stamps', 'save stamps', 'stamp correction'
    ],
    answer: [
      'Open the Members section in the Branch Manager Dashboard.',
      'Search for the customer.',
      'Enter the corrected stamp value.',
      'Press Save stamps.',
      'Enter the reason for the manual adjustment when prompted.'
    ],
    note: 'The dashboard will show either Reward Stamps or Tier Stamps depending on the customer’s program.'
  },
  {
    id: 'redeem-reward',
    roles: ['owner', 'manager'],
    category: 'Rewards',
    title: 'How does reward redemption work?',
    shortLabel: 'How does reward redemption work?',
    keywords: [
      'redeem', 'redeem reward', 'claim reward', 'reward claim',
      'free reward', 'prize', 'claim prize', 'gamit reward',
      'paano mag redeem', 'reward redemption'
    ],
    answer: [
      'Scan or open the customer loyalty card.',
      'Check the reward or benefit currently available to the customer.',
      'Confirm that the customer meets the reward requirement.',
      'Complete the redemption only after the reward is actually given.',
      'Check the customer record afterward to confirm the redemption was recorded.'
    ],
    note: 'The available reward depends on the card type and the rules configured for the selected loyalty program.'
  },
  {
    id: 'announcements-owner',
    roles: ['owner'],
    category: 'Marketing',
    title: 'How do I send an announcement?',
    shortLabel: 'How do I send an announcement?',
    keywords: [
      'announcement', 'announcements', 'send notification', 'notification',
      'broadcast', 'promo message', 'send promo', 'notify customer',
      'wallet notification', 'mag announcement', 'message customers'
    ],
    answer: [
      'Open Announcements from the Owner Dashboard.',
      'Create a new announcement.',
      'Write a short and clear customer message.',
      'Choose the available program, branch, or audience options.',
      'Review the message, then send it.'
    ],
    note: 'Keep announcements useful and relevant so customers do not feel spammed.'
  },
  {
    id: 'announcements-manager',
    roles: ['manager'],
    category: 'Marketing',
    title: 'How do I send a branch announcement?',
    shortLabel: 'How do I send a branch announcement?',
    keywords: [
      'branch announcement', 'manager announcement', 'send notification',
      'announcement', 'notify customers', 'branch promo'
    ],
    answer: [
      'Press Branch Announcement in the Branch Manager Dashboard.',
      'Write the announcement message.',
      'Use the program options available to your assigned branch.',
      'Review the message.',
      'Send the announcement.'
    ],
    note: 'Manager announcements are locked to the manager’s assigned branch.'
  },
  {
    id: 'staff',
    roles: ['owner'],
    category: 'Team',
    title: 'How do I add a cashier or staff member?',
    shortLabel: 'How do I add a cashier or staff member?',
    keywords: [
      'staff', 'cashier', 'employee', 'add staff', 'cashier account',
      'staff account', 'staff login', 'cashier login', 'crew access',
      'manager access', 'branch staff', 'invite staff'
    ],
    answer: [
      'Open the Team / Staff section in the Owner Dashboard.',
      'Choose the option to invite or add a staff member.',
      'Enter the staff details.',
      'Assign the correct role and branch.',
      'Save the account, then test the staff login before using it in operations.'
    ],
    note: 'Avoid sharing the owner account with cashiers. Give each staff member the correct role and branch access.'
  },
  {
    id: 'branches',
    roles: ['owner'],
    category: 'Business',
    title: 'How do I add or manage a branch?',
    shortLabel: 'How do I add or manage a branch?',
    keywords: [
      'branch', 'branches', 'add branch', 'new branch',
      'branch account', 'branch setup', 'location', 'store branch',
      'assign branch', 'per branch'
    ],
    answer: [
      'Open the branch controls from the Owner Dashboard.',
      'Add the branch name and address.',
      'Save the branch.',
      'Assign the correct manager or cashier to that branch.',
      'Check that future transactions are being recorded under the correct branch.'
    ],
    note: 'Branch availability and limits can depend on your Loyalty Tree subscription or account setup.'
  },
  {
    id: 'analytics',
    roles: ['owner'],
    category: 'Reports',
    title: 'Where can I see analytics and activity?',
    shortLabel: 'Where can I see analytics?',
    keywords: [
      'analytics', 'report', 'reports', 'customers count',
      'member count', 'visits', 'repeat visits', 'dashboard stats',
      'statistics', 'performance', 'branch analytics', 'activity'
    ],
    answer: [
      'Open the analytics or reporting area in the Owner Dashboard.',
      'Choose the program, branch, or period available on the page.',
      'Review customer/member activity and loyalty usage.',
      'Use branch filters when you want to compare locations.',
      'Use the recent activity views when you need to check operational activity.'
    ],
    note: 'Analytics reflect Loyalty Tree activity recorded by the system.'
  },
  {
    id: 'manager-search-member',
    roles: ['manager'],
    category: 'Customers',
    title: 'How do I find a customer?',
    shortLabel: 'How do I find a customer?',
    keywords: [
      'find customer', 'search customer', 'search member', 'find member',
      'member search', 'customer search', 'birthday search'
    ],
    answer: [
      'Go to Members in the Branch Manager Dashboard.',
      'Use the search box.',
      'You can search by name, phone, email, or birthday.',
      'Open the matching member card to review the available information and balance controls.'
    ],
    note: 'If you are viewing All Cards, the member card also shows which loyalty program the customer belongs to.'
  },
  {
    id: 'manager-companion',
    roles: ['manager'],
    category: 'POS',
    title: 'How do I set up Loyalty Tree Companion?',
    shortLabel: 'How do I set up Companion?',
    keywords: [
      'companion', 'pos companion', 'setup companion', 'map pos',
      'pos mapping', 'storehub mapping', 'loyverse mapping', 'apk'
    ],
    answer: [
      'Open Loyalty Tree Companion in the Branch Manager Dashboard.',
      'Choose the connected POS provider and the POS location for your assigned branch.',
      'Press Map branch / Save mapping.',
      'Download the Companion APK when the mapping is ready.',
      'Generate a one-time activation code and enter it on the assigned device.'
    ],
    note: 'The owner must first connect the business POS account and allow the manager to manage Companion devices.'
  },
  {
    id: 'manager-activation-code',
    roles: ['manager'],
    category: 'POS',
    title: 'How do I generate a Companion activation code?',
    shortLabel: 'How do I get an activation code?',
    keywords: [
      'activation code', 'companion code', 'one time code',
      'generate code', 'device activation', 'activate companion'
    ],
    answer: [
      'Make sure the branch is already mapped to the correct POS location.',
      'Press Generate one-time activation code.',
      'Enter the generated code on the Companion device.',
      'Use the code before it expires.',
      'Generate a new code if the previous one expires or has already been used.'
    ],
    note: 'The activation code is tied to the assigned branch/POS mapping and is intended for one device.'
  },
  {
    id: 'wallet-not-added',
    roles: ['owner', 'manager'],
    category: 'Troubleshooting',
    title: 'What if the customer has not added the card to Wallet?',
    shortLabel: 'Customer has no Wallet card yet',
    keywords: [
      'not added wallet', 'wallet not added', 'google wallet not found',
      'apple wallet not added', 'pass not found', 'customer no wallet',
      'has not added this pass', 'wallet sync not found'
    ],
    answer: [
      'Ask the customer to finish adding the Loyalty Tree card to Apple Wallet or Google Wallet.',
      'If the customer registered but did not press Add to Wallet, the Wallet pass may not exist on the device yet.',
      'The customer can still exist in Loyalty Tree even when the Wallet pass has not been saved.',
      'After the customer adds the pass, use the normal customer flow again if needed.'
    ],
    note: 'A “pass not found / has not added this pass” message can simply mean the customer registered but has not saved the pass to Wallet.'
  },
  {
    id: 'save-error',
    roles: ['owner', 'manager'],
    category: 'Troubleshooting',
    title: 'What should I do if a customer change will not save?',
    shortLabel: 'Customer change will not save',
    keywords: [
      'customer could not be saved', 'could not save customer',
      'save customer error', 'cannot save customer', 'customer save failed',
      'failed to save', 'saving error', 'points could not be saved',
      'could not update points', 'could not update stamp balance'
    ],
    answer: [
      'Do not keep pressing Save repeatedly.',
      'Confirm that you selected the correct customer and loyalty program.',
      'Note the exact error message shown.',
      'Refresh the customer/member record once to check whether the change was recorded.',
      'If it still fails, contact Loyalty Tree Support and include the customer name/ID and the exact error.'
    ],
    note: 'Avoid repeated submissions so you do not accidentally create duplicate adjustments.'
  },
]

const OWNER_FAQ_IDS = [
  'scan-to-join',
  'share-join-qr',
  'scan-to-stamp',
  'owner-points-stamps',
  'redeem-reward',
  'staff',
  'branches',
  'announcements-owner',
  'analytics',
  'wallet-not-added',
  'save-error',
]

const MANAGER_FAQ_IDS = [
  'scan-to-stamp',
  'manager-search-member',
  'manager-points',
  'manager-stamps',
  'redeem-reward',
  'announcements-manager',
  'manager-companion',
  'manager-activation-code',
  'wallet-not-added',
  'save-error',
]

const STOP_WORDS = new Set([
  'a','an','the','to','of','for','and','or','is','are','i','we','you','my','our',
  'how','do','does','can','could','please','po','yung','ang','ng','mga','ako','ko',
  'namin','natin','ba','paano','mag','may','sa','si','ito','yan'
])

function normalize(text = '') {
  return String(text)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokens(text = '') {
  return normalize(text)
    .split(' ')
    .filter(Boolean)
    .filter(word => !STOP_WORDS.has(word))
}

function scoreArticle(query, article) {
  const q = normalize(query)
  if (!q) return 0

  const qTokens = new Set(tokens(q))
  let score = 0
  const title = normalize(article.title)

  if (q.includes(title) || title.includes(q)) score += 10

  for (const keywordRaw of article.keywords || []) {
    const keyword = normalize(keywordRaw)
    if (!keyword) continue

    if (q === keyword) score += 16
    else if (q.includes(keyword)) score += 10
    else if (keyword.includes(q) && q.length >= 4) score += 6

    for (const token of tokens(keyword)) {
      if (qTokens.has(token)) score += token.length >= 6 ? 3 : 2
    }
  }

  for (const token of tokens(article.title + ' ' + article.category)) {
    if (qTokens.has(token)) score += 2
  }

  return score
}

function findBestArticle(query, role) {
  const allowed = HELP_ARTICLES.filter(article =>
    !article.roles || article.roles.includes(role)
  )

  const ranked = allowed
    .map(article => ({ article, score: scoreArticle(query, article) }))
    .sort((a, b) => b.score - a.score)

  const best = ranked[0]
  if (!best || best.score < 5) return null
  return best.article
}

function AnswerCard({ article, onBack }) {
  if (!article) return null

  return (
    <div style={styles.answerCard}>
      <div style={{display:'flex',justifyContent:'space-between',gap:8,alignItems:'flex-start'}}>
        <div>
          <div style={styles.answerCategory}>{article.category}</div>
          <div style={styles.answerTitle}>{article.title}</div>
        </div>
        {onBack && (
          <button type="button" onClick={onBack} style={styles.backBtn}>
            FAQs
          </button>
        )}
      </div>

      <ol style={styles.answerList}>
        {article.answer.map((step, index) => (
          <li key={`${article.id}-${index}`} style={styles.answerStep}>
            {step}
          </li>
        ))}
      </ol>

      {article.note && (
        <div style={styles.note}>
          <strong>Note:</strong> {article.note}
        </div>
      )}
    </div>
  )
}

export default function HelpChat({
  role = 'owner',
  businessName = '',
  currentPage = '',
  bottom = 22,
  right = 22,
}) {
  const normalizedRole = role === 'manager' ? 'manager' : 'owner'
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selectedArticle, setSelectedArticle] = useState(null)
  const [messages, setMessages] = useState([])
  const inputRef = useRef(null)
  const scrollRef = useRef(null)

  const faqArticles = useMemo(() => {
    const ids = normalizedRole === 'manager' ? MANAGER_FAQ_IDS : OWNER_FAQ_IDS
    return ids
      .map(id => HELP_ARTICLES.find(article => article.id === id))
      .filter(Boolean)
  }, [normalizedRole])

  const pageLabel = useMemo(() => {
    const text = String(currentPage || '').replace(/[-_]/g, ' ').trim()
    return text ? text.replace(/\b\w/g, c => c.toUpperCase()) : ''
  }, [currentPage])

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 80)
  }, [open])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, selectedArticle, open])

  function openArticle(article) {
    setSelectedArticle(article)
    setMessages([])
    setQuery('')
  }

  function showFaqHome() {
    setSelectedArticle(null)
    setMessages([])
    setQuery('')
  }

  function submitQuestion(rawQuestion) {
    const text = String(rawQuestion || '').trim()
    if (!text) return

    const article = findBestArticle(text, normalizedRole)
    setSelectedArticle(null)

    setMessages(current => [
      ...current,
      { id: `${Date.now()}-user`, role: 'user', text },
      article
        ? { id: `${Date.now()}-bot`, role: 'bot', article }
        : {
            id: `${Date.now()}-fallback`,
            role: 'bot',
            text: 'I could not find an exact answer. Please choose one of the FAQs below or try using the feature name in your question.'
          }
    ])
    setQuery('')
  }

  const assistantLabel = normalizedRole === 'manager'
    ? 'Branch Manager Help'
    : 'Business Owner Help'

  return (
    <>
      {open && (
        <div
          style={{
            ...styles.panel,
            bottom: Number(bottom) + 70,
            right
          }}
          role="dialog"
          aria-label="Loyalty Tree Help"
        >
          <div style={styles.header}>
            <div style={styles.headerLeft}>
              <div style={styles.botLogo}>LT</div>
              <div style={{minWidth:0}}>
                <div style={styles.headerTitle}>Loyalty Tree Help</div>
                <div style={styles.headerSub}>
                  {pageLabel ? `${assistantLabel} · ${pageLabel}` : assistantLabel}
                </div>
              </div>
            </div>

            <div style={styles.headerActions}>
              <button
                type="button"
                onClick={showFaqHome}
                style={styles.iconBtn}
                title="Show FAQs"
                aria-label="Show FAQs"
              >
                ⌂
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                style={styles.iconBtn}
                title="Close help"
                aria-label="Close help"
              >
                ×
              </button>
            </div>
          </div>

          <div ref={scrollRef} style={styles.messages}>
            {selectedArticle ? (
              <AnswerCard article={selectedArticle} onBack={showFaqHome} />
            ) : messages.length === 0 ? (
              <>
                <div style={styles.botBubble}>
                  <div style={styles.welcomeTitle}>
                    Hi{businessName ? `, ${businessName}` : ''}! 👋
                  </div>
                  <div style={styles.welcomeText}>
                    Choose a common question below. You only need to type if your concern is not listed.
                  </div>
                </div>

                <div style={styles.quickLabel}>FREQUENTLY ASKED QUESTIONS</div>
                <div style={styles.faqGrid}>
                  {faqArticles.map((article, index) => (
                    <button
                      key={article.id}
                      type="button"
                      style={styles.faqBtn}
                      onClick={() => openArticle(article)}
                    >
                      <span style={styles.faqNumber}>{index + 1}</span>
                      <span style={styles.faqText}>{article.shortLabel || article.title}</span>
                      <span style={styles.faqArrow}>›</span>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              messages.map(message => (
                <div key={message.id}>
                  {message.role === 'user' ? (
                    <div style={styles.userRow}>
                      <div style={styles.userBubble}>{message.text}</div>
                    </div>
                  ) : (
                    <div style={styles.botRow}>
                      {message.article ? (
                        <AnswerCard article={message.article} onBack={showFaqHome} />
                      ) : (
                        <div style={styles.botBubble}>
                          <div>{message.text}</div>
                          <button
                            type="button"
                            onClick={showFaqHome}
                            style={{...styles.backBtn,marginTop:10}}
                          >
                            View FAQs
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          <form
            style={styles.inputArea}
            onSubmit={event => {
              event.preventDefault()
              submitQuestion(query)
            }}
          >
            <input
              ref={inputRef}
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="Or type your question..."
              style={styles.input}
              autoComplete="off"
            />
            <button
              type="submit"
              style={{
                ...styles.sendBtn,
                opacity: query.trim() ? 1 : 0.45,
                cursor: query.trim() ? 'pointer' : 'default'
              }}
              disabled={!query.trim()}
              aria-label="Send question"
            >
              ➜
            </button>
          </form>

          <div style={styles.footer}>
            Built-in Loyalty Tree guide · No AI or token usage
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        style={{
          ...styles.floatingButton,
          bottom,
          right
        }}
        aria-label={open ? 'Close Loyalty Tree Help' : 'Open Loyalty Tree Help'}
        title="Need help?"
      >
        <span style={{fontSize:20,fontWeight:950}}>{open ? '×' : '?'}</span>
        {!open && <span style={styles.helpText}>Help</span>}
      </button>
    </>
  )
}

const styles = {
  floatingButton: {
    position: 'fixed',
    zIndex: 9999,
    border: 0,
    minWidth: 58,
    height: 58,
    padding: '0 18px',
    borderRadius: 999,
    background: '#0f766e',
    color: '#fff',
    boxShadow: '0 14px 35px rgba(15, 118, 110, 0.28)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    fontWeight: 900,
    cursor: 'pointer'
  },
  helpText: {
    fontSize: 13,
    fontWeight: 850
  },
  panel: {
    position: 'fixed',
    zIndex: 9998,
    width: 'min(410px, calc(100vw - 24px))',
    height: 'min(660px, calc(100vh - 110px))',
    minHeight: 430,
    background: '#fff',
    border: '1px solid #e2e8f0',
    borderRadius: 20,
    boxShadow: '0 24px 70px rgba(15, 23, 42, 0.20)',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column'
  },
  header: {
    padding: '14px 14px 13px',
    background: 'linear-gradient(135deg, #0f766e 0%, #0d9488 100%)',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    minWidth: 0
  },
  botLogo: {
    width: 38,
    height: 38,
    borderRadius: 12,
    background: 'rgba(255,255,255,.18)',
    border: '1px solid rgba(255,255,255,.24)',
    display: 'grid',
    placeItems: 'center',
    fontSize: 13,
    fontWeight: 950,
    flex: '0 0 auto'
  },
  headerTitle: {
    fontWeight: 900,
    fontSize: 14.5,
    lineHeight: 1.2
  },
  headerSub: {
    marginTop: 3,
    fontSize: 10.5,
    opacity: 0.84,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    maxWidth: 245
  },
  headerActions: {
    display: 'flex',
    gap: 5
  },
  iconBtn: {
    width: 32,
    height: 32,
    borderRadius: 10,
    border: '1px solid rgba(255,255,255,.18)',
    background: 'rgba(255,255,255,.12)',
    color: '#fff',
    cursor: 'pointer',
    fontSize: 17,
    lineHeight: 1
  },
  messages: {
    flex: 1,
    overflowY: 'auto',
    padding: 14,
    background: '#f8fafc'
  },
  botRow: {
    display: 'flex',
    justifyContent: 'flex-start',
    marginBottom: 12
  },
  userRow: {
    display: 'flex',
    justifyContent: 'flex-end',
    marginBottom: 12
  },
  botBubble: {
    width: '100%',
    boxSizing: 'border-box',
    background: '#fff',
    border: '1px solid #e2e8f0',
    borderRadius: 16,
    padding: 13,
    color: '#334155',
    fontSize: 12.5,
    lineHeight: 1.5,
    boxShadow: '0 4px 12px rgba(15,23,42,.04)'
  },
  userBubble: {
    maxWidth: '85%',
    background: '#0f766e',
    color: '#fff',
    borderRadius: '16px 16px 5px 16px',
    padding: '10px 12px',
    fontSize: 12.5,
    lineHeight: 1.45
  },
  welcomeTitle: {
    fontWeight: 900,
    color: '#0f172a',
    marginBottom: 4
  },
  welcomeText: {
    color: '#475569'
  },
  quickLabel: {
    margin: '14px 2px 8px',
    fontSize: 9.5,
    fontWeight: 900,
    color: '#94a3b8',
    letterSpacing: '.08em'
  },
  faqGrid: {
    display: 'grid',
    gap: 7
  },
  faqBtn: {
    width: '100%',
    border: '1px solid #dbe5e1',
    background: '#fff',
    borderRadius: 12,
    padding: '10px 10px',
    display: 'grid',
    gridTemplateColumns: '28px minmax(0,1fr) 18px',
    alignItems: 'center',
    gap: 8,
    color: '#0f172a',
    cursor: 'pointer',
    textAlign: 'left',
    boxShadow: '0 2px 8px rgba(15,23,42,.025)'
  },
  faqNumber: {
    width: 26,
    height: 26,
    display: 'grid',
    placeItems: 'center',
    borderRadius: 8,
    background: '#f0fdfa',
    color: '#0f766e',
    fontSize: 10,
    fontWeight: 950
  },
  faqText: {
    fontSize: 11.5,
    fontWeight: 800,
    lineHeight: 1.35
  },
  faqArrow: {
    fontSize: 20,
    color: '#94a3b8',
    textAlign: 'center'
  },
  answerCard: {
    width: '100%',
    boxSizing: 'border-box',
    background: '#fff',
    border: '1px solid #e2e8f0',
    borderRadius: 16,
    padding: 13,
    color: '#334155',
    boxShadow: '0 4px 12px rgba(15,23,42,.04)'
  },
  answerCategory: {
    display: 'inline-block',
    fontSize: 9,
    fontWeight: 900,
    color: '#0f766e',
    background: '#f0fdfa',
    borderRadius: 999,
    padding: '4px 7px',
    marginBottom: 7,
    textTransform: 'uppercase',
    letterSpacing: '.05em'
  },
  answerTitle: {
    fontSize: 13.5,
    fontWeight: 900,
    color: '#0f172a',
    marginBottom: 7,
    lineHeight: 1.35
  },
  answerList: {
    margin: '4px 0 0 18px',
    padding: 0
  },
  answerStep: {
    paddingLeft: 3,
    marginBottom: 6,
    fontSize: 12,
    lineHeight: 1.45
  },
  note: {
    marginTop: 10,
    padding: '9px 10px',
    background: '#f8fafc',
    borderRadius: 10,
    color: '#475569',
    fontSize: 10.5,
    lineHeight: 1.45
  },
  backBtn: {
    border: '1px solid #ccfbf1',
    background: '#f0fdfa',
    color: '#0f766e',
    borderRadius: 9,
    padding: '6px 8px',
    fontSize: 10,
    fontWeight: 850,
    cursor: 'pointer',
    whiteSpace: 'nowrap'
  },
  inputArea: {
    display: 'flex',
    gap: 8,
    padding: '10px 12px',
    borderTop: '1px solid #e2e8f0',
    background: '#fff'
  },
  input: {
    flex: 1,
    minWidth: 0,
    border: '1px solid #cbd5e1',
    borderRadius: 12,
    padding: '10px 11px',
    outline: 'none',
    fontSize: 12.5,
    color: '#0f172a',
    background: '#fff'
  },
  sendBtn: {
    width: 40,
    height: 40,
    border: 0,
    borderRadius: 12,
    background: '#0f766e',
    color: '#fff',
    fontWeight: 900,
    fontSize: 17
  },
  footer: {
    padding: '0 12px 9px',
    background: '#fff',
    color: '#94a3b8',
    fontSize: 8.8,
    textAlign: 'center'
  }
}
