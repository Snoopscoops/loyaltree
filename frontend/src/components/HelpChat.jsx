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
 * Help usage can be logged to the Loyalty Tree backend when API/user context is provided.
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

  {
    id: 'dashboard-overview',
    roles: ['owner'],
    category: 'Dashboard',
    title: 'What can I see on the Owner Dashboard overview?',
    shortLabel: 'What is on the Owner Dashboard?',
    keywords: [
      'owner dashboard', 'dashboard overview', 'overview page', 'home dashboard',
      'ano nasa dashboard', 'ano makikita sa dashboard',
      'ania ti makita iti dashboard', 'unsa makita sa dashboard'
    ],
    answer: [
      'The Overview gives you a quick picture of your current loyalty program.',
      'You can see customer/member totals and the main balance or activity metrics for the selected card type.',
      'Use the quick actions to open customers, scan a customer, manage your team, or share the Join QR.',
      'Recent activity helps you quickly check the latest customer loyalty records.',
      'If you have more than one loyalty program, choose the program you want to manage before using program-specific actions.'
    ],
    note: 'The numbers shown change depending on whether your card uses stamps, points, memberships, tiers, multi-pass sessions, hybrid rewards, or employee cards.'
  },
  {
    id: 'customers-owner',
    roles: ['owner'],
    category: 'Customers',
    title: 'What can I do in the Customers section?',
    shortLabel: 'What can I do with Customers?',
    keywords: [
      'customers section', 'customer list', 'manage customers', 'members list',
      'customer records', 'ano pwede sa customers', 'customer management',
      'customer ti dashboard', 'unsa mahimo sa customers'
    ],
    answer: [
      'See the customers or members enrolled in the selected loyalty program.',
      'Search by the customer information available in the dashboard.',
      'Open a customer record to review their loyalty status and card information.',
      'Use the available controls for the current card type, such as stamps, points, membership status, sessions, or tier progress.',
      'Open Analytics when you need a broader view of customer activity instead of a single customer record.'
    ],
    note: 'The exact customer controls depend on the loyalty card type configured for that program.'
  },
  {
    id: 'customer-card-owner',
    roles: ['owner'],
    category: 'Customers',
    title: 'Can I view a customer’s digital loyalty card?',
    shortLabel: 'How do I view a customer card?',
    keywords: [
      'view customer card', 'customer loyalty card', 'member card', 'digital card preview',
      'tingnan customer card', 'makita customer card',
      'makita ti customer card', 'tan aw customer card'
    ],
    answer: [
      'Open the Customers section.',
      'Select the customer you want to review.',
      'Open the available card/customer detail view.',
      'The preview can show the customer identity and the progress that belongs to the configured card type.',
      'Use this for verification and support; normal earning activity should still follow the business operating flow.'
    ],
    note: 'The displayed fields can differ for stamps, points, memberships, VIP tiers, hybrid cards, multi-pass, and employee cards.'
  },
  {
    id: 'card-types-owner',
    roles: ['owner'],
    category: 'Card & Rewards',
    title: 'What loyalty card types can I manage?',
    shortLabel: 'What card types are available?',
    keywords: [
      'card types', 'stamp card', 'points card', 'membership card', 'vip card',
      'multipass', 'hybrid card', 'employee card', 'loyalty program types',
      'anong card types', 'ania card types', 'unsa card types'
    ],
    answer: [
      'LoyaltyTree can support different loyalty experiences depending on your account and program setup.',
      'Examples in the Owner Dashboard include stamp rewards, points, memberships/subscriptions, VIP or tier programs, multi-pass/session cards, hybrid programs, and employee cards.',
      'Each type changes the customer metrics, card details, and operating controls shown in the dashboard.',
      'Choose the card structure that matches how your business actually rewards or serves customers.'
    ],
    note: 'Available program limits and advanced features can depend on the business plan or custom account setup.'
  },
  {
    id: 'card-customizer-owner',
    roles: ['owner'],
    category: 'Card & Rewards',
    title: 'How do I edit my loyalty card and program rules?',
    shortLabel: 'How do I edit my card?',
    keywords: [
      'edit card', 'card design', 'card customizer', 'program rules', 'reward rules',
      'change logo', 'change banner', 'change colors', 'edit loyalty program',
      'palitan card design', 'baguhin card', 'urnosen card', 'usba card'
    ],
    answer: [
      'Open Card from the Owner Dashboard.',
      'Select the loyalty program you want to edit when your business has multiple programs.',
      'Use the available card/program controls to update the program configuration and branding.',
      'Review the reward or membership rules carefully before saving.',
      'After saving, check the dashboard and customer card experience to confirm the intended setup.'
    ],
    note: 'Only change live loyalty rules intentionally because they affect how future customer activity is interpreted.'
  },
  {
    id: 'multiple-programs-owner',
    roles: ['owner'],
    category: 'Card & Rewards',
    title: 'Can my business have more than one loyalty program?',
    shortLabel: 'Can I manage multiple loyalty programs?',
    keywords: [
      'multiple programs', 'more than one card', 'second loyalty card', 'add program',
      'many loyalty programs', 'dalawang card', 'multiple cards',
      'adu a program', 'daghang loyalty program'
    ],
    answer: [
      'If your account allows multiple programs, the Owner Dashboard shows a program selector.',
      'Select one program before using program-specific actions such as scanning, sharing a Join QR, or editing card rules.',
      'Customer counts can be viewed per program, while the dashboard can also show an all-program view when available.',
      'Keep each program purpose clear so staff know which card to use for each customer.'
    ],
    note: 'The number of programs available depends on the business plan or account configuration.'
  },
  {
    id: 'setup-guide-owner',
    roles: ['owner'],
    category: 'Getting Started',
    title: 'What is the Setup Guide for?',
    shortLabel: 'What does the Setup Guide do?',
    keywords: [
      'setup guide', 'onboarding guide', 'setup business', 'first setup',
      'paano setup', 'guide setup', 'kasano setup', 'unsaon setup'
    ],
    answer: [
      'The Setup Guide walks you through the important first-time configuration steps.',
      'Use it when you want a guided path instead of opening dashboard sections one by one.',
      'It helps you prepare the loyalty card/program and the operating setup needed before daily use.',
      'You can reopen the Setup Guide later from More if you need to review the setup flow.'
    ],
    note: 'The guide is especially useful when a new owner or administrator is learning LoyaltyTree for the first time.'
  },
  {
    id: 'home-screen-owner',
    roles: ['owner'],
    category: 'Getting Started',
    title: 'Can I add LoyaltyTree to my phone Home Screen?',
    shortLabel: 'How do I add LoyaltyTree to Home Screen?',
    keywords: [
      'add to home screen', 'install app', 'pwa', 'phone home screen',
      'install loyaltytree', 'add app', 'ilagay sa home screen',
      'ikabil home screen', 'ibutang home screen'
    ],
    answer: [
      'On supported phones, use Add to Home Screen from the LoyaltyTree dashboard or your browser.',
      'On iPhone/iPad, open the dashboard in Safari, use Share, then choose Add to Home Screen.',
      'On Android, use the browser Install app or Add to Home screen option when available.',
      'After installation, LoyaltyTree can open from the Home Screen like an app shortcut.'
    ],
    note: 'This installs the web app experience; customers still do not need to download a separate LoyaltyTree customer app.'
  },
  {
    id: 'campaigns-owner',
    roles: ['owner'],
    category: 'Grow & Marketing',
    title: 'What is the Campaigns section for?',
    shortLabel: 'What can I do with Campaigns?',
    keywords: [
      'campaigns', 'marketing campaigns', 'customer campaign', 'promo campaign',
      'campaign section', 'promo', 'marketing', 'kampanya',
      'campaign iti dashboard', 'campaign sa dashboard'
    ],
    answer: [
      'Open Grow, then Campaigns.',
      'Use Campaigns for the campaign tools available to your business account.',
      'Keep each campaign tied to a clear customer objective such as engagement, return visits, or a specific promotion.',
      'Use Analytics and customer activity to review whether customers are engaging with your loyalty program over time.'
    ],
    note: 'The exact campaign controls available can depend on the enabled LoyaltyTree features for your account.'
  },
  {
    id: 'satisfaction-owner',
    roles: ['owner'],
    category: 'Grow & Marketing',
    title: 'How does Customer Satisfaction work?',
    shortLabel: 'How do I see customer feedback?',
    keywords: [
      'customer satisfaction', 'feedback', 'ratings', 'reviews', 'customer rating',
      'service rating', 'quality rating', 'value rating', 'feedback customers',
      'satisfaction', 'komento customer', 'customer feedback'
    ],
    answer: [
      'Open Grow, then Satisfaction.',
      'The dashboard shows feedback submitted by customers through the LoyaltyTree Wallet card experience.',
      'Review the overall rating, response count, positive rating share, and available service, quality, and value ratings.',
      'Read customer comments to identify recurring service issues or strengths.',
      'Refresh the section when you want the latest recorded feedback.'
    ],
    note: 'Feedback appears only when customers submit a rating through the available LoyaltyTree customer experience.'
  },
  {
    id: 'gift-cards-owner',
    roles: ['owner'],
    category: 'Operate',
    title: 'What is the Gift Cards section for?',
    shortLabel: 'What can I do with Gift Cards?',
    keywords: [
      'gift cards', 'gift card', 'giftcards', 'sell gift card', 'gift voucher',
      'regalo card', 'gift card dashboard', 'gift card owner'
    ],
    answer: [
      'Open Operate, then Gift Cards.',
      'Use the Gift Cards section for the gift-card tools enabled for your business.',
      'Keep gift-card operations separate from normal loyalty earning so staff can clearly distinguish stored gift value from loyalty rewards.',
      'Use the section’s current controls and records when managing gift-card activity.'
    ],
    note: 'Gift-card capabilities shown in the dashboard depend on the features enabled for the business.'
  },
  {
    id: 'order-ahead-owner',
    roles: ['owner'],
    category: 'Operate',
    title: 'What is Order Ahead?',
    shortLabel: 'How does Order Ahead work?',
    keywords: [
      'order ahead', 'advance order', 'pre order', 'customer order', 'pickup order',
      'order ahead dashboard', 'order before arrival', 'preorder',
      'advance order customer', 'order daan'
    ],
    answer: [
      'Order Ahead appears under Operate when Super Admin has enabled it for the business.',
      'It provides the business-side setup and operating controls for the enabled customer ordering experience.',
      'Use the available branch and menu/product controls to keep the customer ordering flow accurate.',
      'Only use this section when Order Ahead is part of your LoyaltyTree account setup.'
    ],
    note: 'If you do not see Order Ahead, it may not be enabled for your business.'
  },
  {
    id: 'pos-owner',
    roles: ['owner'],
    category: 'Operate',
    title: 'What is POS Integration for?',
    shortLabel: 'What does POS Integration do?',
    keywords: [
      'pos integration', 'storehub', 'loyverse', 'connect pos', 'pos system',
      'pos loyalty', 'point of sale integration', 'connect storehub',
      'ikabit pos', 'pos iti loyaltytree', 'pos sa loyaltytree'
    ],
    answer: [
      'Open Operate, then POS Integration.',
      'POS Integration is used when your LoyaltyTree account is configured to connect loyalty activity with a supported POS workflow.',
      'The owner handles the business-level POS connection and configuration available to the account.',
      'Branch managers can then use allowed branch-level Companion controls when those features are enabled.',
      'Follow the specific integration instructions for your POS provider because the setup can differ by provider.'
    ],
    note: 'The dashboard marks POS Integration as a Pro feature unless your account has custom access.'
  },
  {
    id: 'setup-kit-owner',
    roles: ['owner'],
    category: 'Operate',
    title: 'What is the Physical QR / PR Kit?',
    shortLabel: 'What is the QR / PR Kit?',
    keywords: [
      'qr kit', 'pr kit', 'physical qr', 'setup kit', 'printed qr',
      'delivery qr', 'join qr print', 'qr materials', 'kit delivery'
    ],
    answer: [
      'When a setup kit is available for your account, the Overview shows a Physical QR / PR Kit panel.',
      'Confirm the final logo, recipient, contact number, delivery address, and delivery instructions.',
      'The Join QR is generated for the business and can be used in the printed materials.',
      'Save the kit details so LoyaltyTree operations has the correct fulfillment information.'
    ],
    note: 'The panel appears only for businesses with a setup-kit record.'
  },
  {
    id: 'billing-owner',
    roles: ['owner'],
    category: 'Billing & Account',
    title: 'Where do I manage my LoyaltyTree subscription?',
    shortLabel: 'Where do I manage billing?',
    keywords: [
      'billing', 'subscription', 'renew', 'payment', 'subscription payment',
      'plan expires', 'renew loyaltytree', 'bayad', 'renewal',
      'billing iti dashboard', 'bayad sa loyaltytree'
    ],
    answer: [
      'Open More, then Billing.',
      'Review the subscription information and payment options shown for your account.',
      'If the subscription is expiring soon or expired, the dashboard can show a renewal warning.',
      'Complete the available payment/renewal flow before the account reaches an expired state when possible.'
    ],
    note: 'Billing details and plan pricing shown in the dashboard are based on the business account configuration.'
  },
  {
    id: 'support-owner',
    roles: ['owner'],
    category: 'Billing & Account',
    title: 'How do I contact LoyaltyTree Support?',
    shortLabel: 'How do I contact Support?',
    keywords: [
      'support', 'contact support', 'help loyaltytree', 'contact loyaltytree',
      'need help', 'technical support', 'customer support', 'tulong',
      'kasapulan tulong', 'tabang loyaltytree'
    ],
    answer: [
      'Open More from the Owner Dashboard.',
      'Choose Support.',
      'Use the available LoyaltyTree support contact flow for concerns that cannot be solved by the Help Center.',
      'When reporting a problem, include the business, affected feature, exact error message, and the customer or transaction reference when relevant.'
    ],
    note: 'Check the Help Center first for common operating questions so support can focus on account-specific or technical issues.'
  },
  {
    id: 'benefits-overview',
    roles: ['owner'],
    category: 'Business Benefits',
    title: 'What are the main benefits of LoyaltyTree for my business?',
    shortLabel: 'What are the main business benefits?',
    keywords: [
      'loyaltytree benefits', 'business benefits', 'why loyaltytree', 'benefit owner',
      'what can loyaltytree do', 'ano benefit', 'bakit loyaltytree',
      'ania benefit loyaltytree', 'unsa benefit loyaltytree'
    ],
    answer: [
      'Give customers a digital loyalty card they can keep in Apple Wallet or Google Wallet instead of requiring a separate customer app or physical card.',
      'Use Scan to Join and Scan to Stamp to make loyalty enrollment and repeat-visit activity easier to operate.',
      'Use configurable loyalty programs such as stamps, points, memberships, tiers, multi-pass, or other enabled card types.',
      'Communicate with members through the announcement and campaign tools available to your account.',
      'Use customer activity, analytics, satisfaction feedback, and branch/team controls to improve retention operations.',
      'Add optional operational features such as POS integration, Gift Cards, Order Ahead, or custom business features when enabled.'
    ],
    note: 'The exact feature set depends on your LoyaltyTree plan and any custom features enabled for the business.'
  },
  {
    id: 'benefit-no-app',
    roles: ['owner'],
    category: 'Business Benefits',
    title: 'Why is the Wallet-based setup useful?',
    shortLabel: 'Why use Apple/Google Wallet?',
    keywords: [
      'wallet benefit', 'why wallet', 'no app', 'apple wallet benefit', 'google wallet benefit',
      'customer app download', 'digital loyalty card benefit', 'wallet loyalty'
    ],
    answer: [
      'Customers can keep the loyalty card in Apple Wallet or Google Wallet instead of managing a separate physical loyalty card.',
      'The join flow is designed around scanning a QR and saving the card, reducing the need for a separate customer app download.',
      'Returning customers can present the Wallet card during future visits.',
      'This keeps the loyalty experience close to tools customers already use on their phones.'
    ],
    note: 'Customers still need to complete the Join flow and save the pass to their Wallet for the Wallet card to be available on the device.'
  },
  {
    id: 'benefit-retention',
    roles: ['owner'],
    category: 'Business Benefits',
    title: 'How can LoyaltyTree help with repeat visits and retention?',
    shortLabel: 'How does LoyaltyTree help retention?',
    keywords: [
      'retention', 'repeat visits', 'returning customers', 'bring customers back',
      'customer loyalty benefit', 'repeat customer', 'customer retention',
      'balik customer', 'agsubli customer', 'mobalik customer'
    ],
    answer: [
      'A loyalty program gives customers a visible reason to progress toward rewards, benefits, membership access, tiers, or sessions.',
      'The Wallet card gives returning customers a consistent card they can present again on future visits.',
      'Announcements and campaigns can be used to communicate relevant offers or updates to members when those tools are enabled.',
      'Analytics and activity records help you observe whether customers are joining, returning, redeeming, or becoming inactive.',
      'Use these signals to improve your loyalty rules and customer follow-up instead of relying only on guesswork.'
    ],
    note: 'LoyaltyTree records loyalty activity; actual business results also depend on your offer, service, staff execution, and customer experience.'
  },
  {
    id: 'benefit-analytics',
    roles: ['owner'],
    category: 'Business Benefits',
    title: 'What business decisions can LoyaltyTree data support?',
    shortLabel: 'How can the data help my business?',
    keywords: [
      'analytics benefit', 'data benefit', 'business decisions', 'loyalty data',
      'customer insights', 'what can analytics tell me', 'retention analytics'
    ],
    answer: [
      'Use customer/member counts to understand the size of your loyalty audience.',
      'Use recorded activity and repeat-visit information to understand how members are engaging with the program.',
      'Use reward, membership, session, or tier metrics according to the program type you operate.',
      'Use branch filters and reporting views when available to compare activity across locations.',
      'Use satisfaction feedback to identify customer experience issues that loyalty balances alone cannot explain.'
    ],
    note: 'Treat non-POS LoyaltyTree metrics as loyalty/customer activity, not as complete sales or revenue reporting.'
  },
  {
    id: 'benefit-team-branches',
    roles: ['owner'],
    category: 'Business Benefits',
    title: 'How does LoyaltyTree help multi-branch and staff operations?',
    shortLabel: 'How does it help branches and staff?',
    keywords: [
      'multi branch benefit', 'branches benefit', 'staff benefit', 'team management benefit',
      'multiple branches loyalty', 'branch operations', 'cashier access', 'manager access'
    ],
    answer: [
      'Create and manage the branches available to the business account.',
      'Assign staff or managers to the appropriate operational role and branch instead of sharing the owner login.',
      'Keep customer and transaction activity associated with the correct branch when the feature flow supports branch tracking.',
      'Use branch-level views and analytics where available to understand how locations are operating.',
      'Use manager permissions for day-to-day operations while keeping owner-level controls with the business owner.'
    ],
    note: 'Available branch counts and manager controls depend on the account configuration and enabled features.'
  },
  {
    id: 'benefit-marketing',
    roles: ['owner'],
    category: 'Business Benefits',
    title: 'How can I use LoyaltyTree for customer engagement?',
    shortLabel: 'How can I engage customers?',
    keywords: [
      'customer engagement', 'marketing benefit', 'announcements benefit', 'campaign benefit',
      'send updates customers', 'wallet notification benefit', 'engage members'
    ],
    answer: [
      'Use Announcements to send relevant business or loyalty updates through the available LoyaltyTree notification flow.',
      'Use Campaigns for the campaign tools enabled on your account.',
      'Use rewards, memberships, tiers, or program benefits to give customers a reason to interact again.',
      'Use Satisfaction feedback and Analytics to decide what messages or offers are worth repeating.',
      'Keep communication useful and targeted so loyalty messaging supports the customer relationship rather than becoming spam.'
    ],
    note: 'Notification delivery depends on the customer card/Wallet state and the messaging capabilities enabled for the business.'
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

const HELP_CATEGORIES = [
  {
    id: 'getting-started',
    label: 'Getting Started',
    icon: '🚀',
    description: 'Set up LoyaltyTree and learn the basic customer flow.',
    roles: ['owner'],
    articleIds: ['dashboard-overview','setup-guide-owner','scan-to-join','share-join-qr','scan-to-stamp','home-screen-owner'],
  },
  {
    id: 'customers',
    label: 'Customers',
    icon: '👥',
    description: 'Members, customer cards, balances, and customer records.',
    roles: ['owner','manager'],
    articleIds: ['customers-owner','manager-search-member','customer-card-owner','owner-points-stamps','manager-points','manager-stamps','wallet-not-added'],
  },
  {
    id: 'cards-rewards',
    label: 'Cards & Rewards',
    icon: '🎟️',
    description: 'Card types, program rules, rewards, and redemption.',
    roles: ['owner','manager'],
    articleIds: ['card-types-owner','card-customizer-owner','multiple-programs-owner','redeem-reward'],
  },
  {
    id: 'team-branches',
    label: 'Team & Branches',
    icon: '🏪',
    description: 'Staff, cashiers, managers, branches, and access.',
    roles: ['owner'],
    articleIds: ['staff','branches'],
  },
  {
    id: 'grow',
    label: 'Grow & Marketing',
    icon: '📣',
    description: 'Announcements, campaigns, feedback, and analytics.',
    roles: ['owner','manager'],
    articleIds: ['announcements-owner','announcements-manager','campaigns-owner','satisfaction-owner','analytics'],
  },
  {
    id: 'operate',
    label: 'Operate',
    icon: '⚙️',
    description: 'POS, Companion, Order Ahead, Gift Cards, and setup kit.',
    roles: ['owner','manager'],
    articleIds: ['pos-owner','manager-companion','manager-activation-code','order-ahead-owner','gift-cards-owner','setup-kit-owner'],
  },
  {
    id: 'billing-account',
    label: 'Billing & Account',
    icon: '💳',
    description: 'Subscription, renewal, setup help, and support.',
    roles: ['owner'],
    articleIds: ['billing-owner','support-owner'],
  },
  {
    id: 'business-benefits',
    label: 'Business Benefits',
    icon: '🌳',
    description: 'Why each LoyaltyTree capability matters to your business.',
    roles: ['owner'],
    articleIds: ['benefits-overview','benefit-no-app','benefit-retention','benefit-analytics','benefit-team-branches','benefit-marketing'],
  },
  {
    id: 'troubleshooting',
    label: 'Troubleshooting',
    icon: '🛟',
    description: 'Common errors and quick fixes.',
    roles: ['owner','manager'],
    articleIds: ['save-error','wallet-not-added'],
  },
  {
    id: 'manager-daily',
    label: 'Daily Branch Operations',
    icon: '📷',
    description: 'Scan, search, correct balances, and redeem rewards.',
    roles: ['manager'],
    articleIds: ['scan-to-stamp','manager-search-member','manager-points','manager-stamps','redeem-reward'],
  },
]

const STOP_WORDS = new Set([
  'a','an','the','to','of','for','and','or','is','are','i','we','you','my','our',
  'how','do','does','can','could','please','po','yung','ang','ng','mga','ako','ko',
  'namin','natin','ba','paano','pano','mag','may','sa','si','ito','yan','nga','ti','dagiti',
  'unsaon','asa','ang','ug','og','sa','si','mga','ba','man','lang'
])

// Common phrasing seen in English, Filipino/Taglish, Ilocano and Bisaya/Cebuano.
// This remains deterministic: no translation API or AI model is called.
const MULTILINGUAL_REPLACEMENTS = [
  // Filipino / Taglish
  ['paano mag', 'how'], ['pano mag', 'how'], ['paano', 'how'], ['pano', 'how'],
  ['magdagdag', 'add'], ['dagdagan', 'add'], ['dagdag', 'add'], ['idagdag', 'add'],
  ['empleyado', 'staff'], ['tauhan', 'staff'], ['miyembro', 'member'], ['hanapin', 'search'],
  ['nasaan', 'where'], ['saan', 'where'], ['hindi ma save', 'cannot save'], ['di ma save', 'cannot save'],
  ['ayaw ma save', 'cannot save'], ['hindi', 'not'], ['wala', 'not'], ['puntos', 'points'],
  ['tatak', 'stamp'], ['gantimpala', 'reward'], ['anunsyo', 'announcement'],

  // Ilocano
  ['kasano nga', 'how'], ['kasano', 'how'], ['sadino', 'where'], ['mangnayon', 'add'],
  ['inayon', 'add'], ['nayonan', 'add'], ['agbirok', 'search'], ['biroken', 'search'],
  ['miyembro', 'member'], ['empleyado', 'staff'], ['saan nga ma save', 'cannot save'],
  ['saan ma save', 'cannot save'], ['awan', 'not'], ['saan', 'not'], ['puntos', 'points'],
  ['premio', 'reward'], ['pakdaar', 'announcement'],

  // Bisaya / Cebuano
  ['unsaon pag', 'how'], ['unsaon', 'how'], ['asa', 'where'], ['pagdugang', 'add'],
  ['dugangi', 'add'], ['dugang', 'add'], ['pangitaa', 'search'], ['pangita', 'search'],
  ['miyembro', 'member'], ['empleyado', 'staff'], ['dili ma save', 'cannot save'],
  ['di ma save', 'cannot save'], ['dili', 'not'], ['walay', 'not'], ['puntos', 'points'],
  ['ganti', 'reward'], ['pahibalo', 'announcement'],
]

const ARTICLE_LANGUAGE_KEYWORDS = {
  'scan-to-join': [
    'paano sumali sa loyalty', 'paano mag join customer',
    'kasano ti panag join ti customer', 'kasano sumali ti customer',
    'unsaon pag join sa customer', 'unsaon pag apil sa loyalty'
  ],
  'share-join-qr': [
    'paano ishare join qr', 'saan join qr',
    'kasano i share ti join qr', 'sadino ti join qr',
    'unsaon pag share sa join qr', 'asa ang join qr'
  ],
  'scan-to-stamp': [
    'paano mag stamp ng customer', 'paano i scan customer card',
    'kasano ag stamp ti customer', 'kasano i scan ti card',
    'unsaon pag stamp sa customer', 'unsaon pag scan sa customer card'
  ],
  'owner-points-stamps': [
    'paano ayusin points', 'paano dagdag points', 'paano ayusin stamps',
    'kasano ayusen ti points', 'kasano mangnayon points',
    'unsaon pag ayo sa points', 'unsaon pagdugang points', 'unsaon pag ayo sa stamps'
  ],
  'manager-points': [
    'paano ayusin customer points', 'kasano ayusen ti customer points',
    'unsaon pag ayo sa customer points'
  ],
  'manager-stamps': [
    'paano ayusin customer stamps', 'kasano ayusen ti customer stamps',
    'unsaon pag ayo sa customer stamps'
  ],
  'redeem-reward': [
    'paano mag claim reward', 'paano mag redeem',
    'kasano ag claim ti reward', 'kasano ag redeem',
    'unsaon pag claim sa reward', 'unsaon pag redeem sa reward'
  ],
  'announcements-owner': [
    'paano mag send notification', 'paano mag announcement',
    'kasano ag send ti pakdaar', 'kasano ag send notification',
    'unsaon pag send pahibalo', 'unsaon pag send notification'
  ],
  'announcements-manager': [
    'paano mag branch announcement', 'kasano ag branch announcement',
    'unsaon pag branch announcement'
  ],
  'staff': [
    'paano magdagdag cashier', 'paano magdagdag empleyado',
    'kasano mangnayon ti cashier', 'kasano mangnayon ti empleyado',
    'unsaon pagdugang og cashier', 'unsaon pagdugang og empleyado', 'dugang staff'
  ],
  'branches': [
    'paano magdagdag branch', 'paano gumawa bagong branch',
    'kasano mangnayon ti branch', 'kasano agaramid baro a branch',
    'unsaon pagdugang og branch', 'unsaon paghimo bag ong branch'
  ],
  'analytics': [
    'saan analytics', 'paano makita reports',
    'sadino ti analytics', 'kasano makita ti reports',
    'asa ang analytics', 'unsaon pagtan aw sa reports'
  ],
  'manager-search-member': [
    'paano hanapin customer', 'saan hanapin member',
    'kasano agbirok customer', 'sadino ti member',
    'unsaon pagpangita customer', 'asa pangitaon ang member'
  ],
  'manager-companion': [
    'paano setup companion', 'kasano i setup ti companion',
    'unsaon pag setup sa companion'
  ],
  'manager-activation-code': [
    'paano kumuha activation code', 'kasano alaen ti activation code',
    'unsaon pagkuha activation code'
  ],
  'wallet-not-added': [
    'wala sa wallet customer', 'hindi na add sa wallet',
    'awan ti card iti wallet', 'saan na add ti wallet',
    'wala sa wallet ang card', 'dili ma add sa wallet'
  ],
  'save-error': [
    'hindi ma save customer', 'ayaw ma save points', 'di ma save stamps',
    'saan ma save ti customer', 'saan ma save ti points',
    'dili ma save ang customer', 'dili ma save points', 'di ma save stamps'
  ],
}

function baseNormalize(text = '') {
  return String(text)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function escapeRegExp(text = '') {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function normalize(text = '') {
  let value = baseNormalize(text)
  for (const [fromRaw, toRaw] of MULTILINGUAL_REPLACEMENTS) {
    const from = baseNormalize(fromRaw)
    const to = baseNormalize(toRaw)
    if (!from) continue
    const pattern = new RegExp(`\\b${escapeRegExp(from).replace(/\\ /g, '\\s+')}\\b`, 'g')
    value = value.replace(pattern, to)
  }
  return value.replace(/\s+/g, ' ').trim()
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

  const multilingualKeywords = ARTICLE_LANGUAGE_KEYWORDS[article.id] || []
  for (const keywordRaw of [...(article.keywords || []), ...multilingualKeywords]) {
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
  API_BASE = '',
  user = null,
  businessIdentifier = '',
  bottom = 22,
  right = 22,
}) {
  const normalizedRole = role === 'manager' ? 'manager' : 'owner'
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selectedArticle, setSelectedArticle] = useState(null)
  const [selectedCategory, setSelectedCategory] = useState('')
  const [messages, setMessages] = useState([])
  const inputRef = useRef(null)
  const scrollRef = useRef(null)

  const helpCategories = useMemo(() => {
    return HELP_CATEGORIES
      .filter(category => !category.roles || category.roles.includes(normalizedRole))
      .map(category => ({
        ...category,
        articles: category.articleIds
          .map(id => HELP_ARTICLES.find(article => article.id === id))
          .filter(article => article && (!article.roles || article.roles.includes(normalizedRole))),
      }))
      .filter(category => category.articles.length > 0)
  }, [normalizedRole])

  const selectedCategoryData = useMemo(
    () => helpCategories.find(category => category.id === selectedCategory) || null,
    [helpCategories, selectedCategory]
  )

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

  const resolvedBusinessIdentifier = String(
    businessIdentifier || user?.business_public_id || user?.business_slug || ''
  ).trim()

  async function recordQuestionEvent({ source, questionText, article = null, answered = false }) {
    if (!API_BASE || !user?.token || !resolvedBusinessIdentifier || !questionText) return false

    try {
      const res = await fetch(
        `${API_BASE}/api/v1/business/${encodeURIComponent(resolvedBusinessIdentifier)}/help/question-event`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${user.token}`,
          },
          body: JSON.stringify({
            source,
            question_text: String(questionText).trim(),
            matched_article_id: article?.id || null,
            matched_article_title: article?.title || null,
            answered: !!answered,
            current_page: String(currentPage || '').trim() || null,
          }),
        }
      )
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        console.warn('Help analytics record failed:', body?.detail || res.status)
        return false
      }
      return true
    } catch (err) {
      console.warn('Help analytics record failed:', err)
      return false
    }
  }

  function openCategory(categoryId) {
    setSelectedCategory(categoryId)
    setSelectedArticle(null)
    setMessages([])
    setQuery('')
  }

  function openArticle(article) {
    setSelectedArticle(article)
    setMessages([])
    setQuery('')
    void recordQuestionEvent({
      source: 'faq_click',
      questionText: article.title,
      article,
      answered: true,
    })
  }

  function showCategory() {
    setSelectedArticle(null)
    setMessages([])
    setQuery('')
  }

  function showFaqHome() {
    setSelectedCategory('')
    setSelectedArticle(null)
    setMessages([])
    setQuery('')
  }

  async function submitQuestion(rawQuestion) {
    const text = String(rawQuestion || '').trim()
    if (!text) return

    const article = findBestArticle(text, normalizedRole)
    setSelectedArticle(null)
    setQuery('')

    if (article) {
      setMessages(current => [
        ...current,
        { id: `${Date.now()}-user`, role: 'user', text },
        { id: `${Date.now()}-bot`, role: 'bot', article },
      ])
      void recordQuestionEvent({
        source: 'typed',
        questionText: text,
        article,
        answered: true,
      })
      return
    }

    const recorded = await recordQuestionEvent({
      source: 'typed',
      questionText: text,
      article: null,
      answered: false,
    })

    setMessages(current => [
      ...current,
      { id: `${Date.now()}-user`, role: 'user', text },
      {
        id: `${Date.now()}-fallback`,
        role: 'bot',
        text: recorded
          ? 'I could not find an exact answer. I recorded this question for Loyalty Tree to review and add to the Help Center.'
          : 'I could not find an exact answer. Please choose one of the FAQs below or try using the feature name in your question.'
      }
    ])
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
              <AnswerCard article={selectedArticle} onBack={selectedCategory ? showCategory : showFaqHome} />
            ) : messages.length === 0 ? (
              selectedCategoryData ? (
                <>
                  <button type="button" onClick={showFaqHome} style={styles.categoryBackBtn}>← All categories</button>
                  <div style={styles.categoryHero}>
                    <div style={styles.categoryHeroIcon}>{selectedCategoryData.icon}</div>
                    <div>
                      <div style={styles.categoryHeroTitle}>{selectedCategoryData.label}</div>
                      <div style={styles.categoryHeroText}>{selectedCategoryData.description}</div>
                    </div>
                  </div>

                  <div style={styles.quickLabel}>CHOOSE A QUESTION</div>
                  <div style={styles.faqGrid}>
                    {selectedCategoryData.articles.map((article, index) => (
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
                <>
                  <div style={styles.botBubble}>
                    <div style={styles.welcomeTitle}>
                      Hi{businessName ? `, ${businessName}` : ''}! 👋
                    </div>
                    <div style={styles.welcomeText}>
                      Choose what you need help with. You can also type naturally in English, Filipino/Taglish, Ilocano, or Bisaya/Cebuano.
                    </div>
                  </div>

                  <div style={styles.quickLabel}>HELP CATEGORIES</div>
                  <div style={styles.categoryGrid}>
                    {helpCategories.map(category => (
                      <button
                        key={category.id}
                        type="button"
                        style={styles.categoryBtn}
                        onClick={() => openCategory(category.id)}
                      >
                        <span style={styles.categoryIcon}>{category.icon}</span>
                        <span style={styles.categoryBody}>
                          <strong style={styles.categoryTitle}>{category.label}</strong>
                          <small style={styles.categoryDescription}>{category.description}</small>
                        </span>
                        <span style={styles.faqArrow}>›</span>
                      </button>
                    ))}
                  </div>
                </>
              )
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
            English · Filipino · Ilocano · Bisaya/Cebuano · No AI or token usage
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
  categoryGrid: {
    display: 'grid',
    gap: 8
  },
  categoryBtn: {
    width: '100%',
    border: '1px solid #dbe5e1',
    background: '#fff',
    borderRadius: 14,
    padding: '11px 10px',
    display: 'grid',
    gridTemplateColumns: '38px minmax(0,1fr) 18px',
    alignItems: 'center',
    gap: 9,
    color: '#0f172a',
    cursor: 'pointer',
    textAlign: 'left',
    boxShadow: '0 2px 8px rgba(15,23,42,.025)'
  },
  categoryIcon: {
    width: 36,
    height: 36,
    display: 'grid',
    placeItems: 'center',
    borderRadius: 11,
    background: '#f0fdfa',
    fontSize: 18
  },
  categoryBody: {
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 2
  },
  categoryTitle: {
    fontSize: 11.8,
    color: '#0f172a',
    lineHeight: 1.3
  },
  categoryDescription: {
    fontSize: 9.7,
    color: '#64748b',
    lineHeight: 1.35
  },
  categoryBackBtn: {
    border: 0,
    background: 'transparent',
    color: '#0f766e',
    fontSize: 10.5,
    fontWeight: 850,
    padding: '0 2px 9px',
    cursor: 'pointer'
  },
  categoryHero: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 15,
    border: '1px solid #ccfbf1',
    background: '#f0fdfa'
  },
  categoryHeroIcon: {
    width: 42,
    height: 42,
    borderRadius: 12,
    background: '#fff',
    display: 'grid',
    placeItems: 'center',
    fontSize: 21,
    border: '1px solid #ccfbf1'
  },
  categoryHeroTitle: {
    fontSize: 13.5,
    fontWeight: 900,
    color: '#0f172a'
  },
  categoryHeroText: {
    marginTop: 3,
    fontSize: 10.3,
    lineHeight: 1.4,
    color: '#64748b'
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
