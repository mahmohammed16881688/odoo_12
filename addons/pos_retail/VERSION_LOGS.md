***7.2.1:*** add picking delayed, Allow picking create later (improve performance POS order). Cashier small times for waiting order process

***7.2.2:*** add option auto sync backend: Manual / Automatic

***7.2.3:*** Add dark mode

***7.2.4:*** Fixed promotion 3

***7.2.5:*** Improve promotion
- [x] 
- [x] 
- [x] 
- [x] 

***7.2.6:*** Add 2 button [Add promotion and remove promotion] on payment screen

***7.2.7:*** Fix bugs
- [x] Fix not clear search products when click product

***7.3.0:*** Fix bugs
- [x] Add button Validate and Post entries on dashboard pos backend: auto validate , pos entries of session selected, and auto close session still online
- [x] Improve sync order, remove function sync all orders, only sync order by order
- [x] Improve header top icon futures, move all to left bar
- [x] Fixed keyboard event
- [x] Fixed multi category
- [x] Fixed cash manager UI

***7.3.1:*** Promotion 5
- [x] Fixed condition and apply promotion 5 (buy pack free gifts)

***7.3.2:*** Improve stock on hand
- [x] Only update stock on hand on pos when stock move is done
- [x] Auto sync and refesh product screen when have stock move (done)
- [x] On pos config default picking delayed is false

***7.3.3:*** Improve lock pos screen
- [x] Add field lock state, when cashiers click lock, lock state is true, and when unlock, lock state is unlock
- [x] When admin not set pos pass pin for user, lock screen now allow input blank pass field

***7.3.3.1:*** Improve quickly search customers

***7.3.3.2:*** Fix price combo when have items default add or required add

***7.3.4:*** Protected code 

***7.3.4.1:*** Add widget show/hide branding list logo on header order widget

***7.3.4.2:*** Fixed bug

- [x] Remote session request remove cache , auto remove cached and reload pos
- [x] function init indexed db auto remove cache and reload pos if have catch exception

***7.3.4.2:*** Fixed bug

- [x] When create internal transfer, if have not stock locations have [availble in pos] will show popup warning
- [x] Move 3 buttons report to one button on header order widget
- [x] Fixed issue tax included when add combo items
- [x] Fixed issue add combo and quantity change
- [x] Fixed issue change qty, auto remove combo items. Required add back

***7.3.4.2:*** Hot fixed mobile app

- [x] Fixed issue return order, plus point and redeem point back to client

***7.3.4.4:*** 

- [x] Add promotion birthday of clients
- [x] Add promotion groups, add customer groups
- [x] Fixed multi unit not create stock move (unit) the same pos line (unit)
- [x] Add button sync pricelist to pos online without reload page
- [x] Add button sync promotions to pos online without reload page
- [x] Remove sync orders, invoice. When cashiers validate orders done, auto get new update from backend

***7.3.5*** We not stored xml receipt to backend for improve performance order save to backend

- [x] Add button push pricelist to pos without reload pos screen on pos config
- [x] On pos config form, add new button remote sessions
- [x] Improve refresh big data, auto reload and reinstall database if have any new field added

***7.3.5.1***

- [x] Fixed: If promotion birthday but client not set, return false
- [x] Fixed: Nothing report config, show popup error exception
- [x] When change pricelist, auto change pricelist realtime
- [x] Fixed issue quicly search client, auto call method save_changes of clientlist screen