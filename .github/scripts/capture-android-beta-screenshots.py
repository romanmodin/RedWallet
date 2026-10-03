"""Capture four public views of the exact signed APK; never retain a seed view."""
import hashlib,json,re,subprocess,time,xml.etree.ElementTree as ET
from pathlib import Path
OUT=Path('promo-screenshots');OUT.mkdir(exist_ok=True)
PACKAGE='com.romanmodin.redwallet';WIDTH=1080;HEIGHT=2400
EXPECTED='e966c2f9594f9e1894c48bf6857fe4df07f51dc04cb83bc53c9db77ed11f438c'
assert hashlib.sha256(Path('signed-beta.apk').read_bytes()).hexdigest()==EXPECTED

def adb(*args):
 return subprocess.check_output(['adb',*map(str,args)],timeout=35)
def nodes():
 adb('shell','uiautomator','dump','/sdcard/redwallet-promo.xml')
 return list(ET.fromstring(adb('shell','cat','/sdcard/redwallet-promo.xml')).iter('node'))
def center(n):
 a,b,c,d=map(int,re.findall(r'\d+',n.attrib['bounds']))
 if c<=a or d<=b or not (0<(a+c)//2<WIDTH and 60<(b+d)//2<HEIGHT-70):return None
 return (a+c)//2,(b+d)//2

def find(key,scroll=False,timeout=90):
 until=time.monotonic()+timeout;swipes=0
 while time.monotonic()<until:
  ns=nodes()
  for n in ns:
   if key in [n.get('resource-id'),n.get('text'),n.get('content-desc')] and n.get('enabled')!='false' and center(n):return n
  if scroll and swipes<8:
   adb('shell','input','swipe',540,1850,540,650,400);swipes+=1
  time.sleep(1)
 raise RuntimeError('Public control unavailable: '+key+'; visible IDs: '+str(sorted({n.get('resource-id') for n in ns if n.get('resource-id')})))
def tap(key,scroll=False,timeout=90):
 x,y=center(find(key,scroll,timeout));adb('shell','input','tap',x,y);time.sleep(1)
def write(key,value):
 tap(key,True)
 adb('shell','input','keyevent',123,*([67]*40))
 adb('shell','input','text',value.replace(' ','%s'))
 time.sleep(1)
def back():adb('shell','input','keyevent',4);time.sleep(1)
def snap(name,required):
 find(required,timeout=60);time.sleep(2)
 ns=nodes()
 # A backup/export or private-key view must never enter this artifact.
 assert not any(n.get('resource-id') in ['PleaseBackupScrollView','Secret','WalletExport'] for n in ns)
 png=adb('exec-out','screencap','-p');assert png.startswith(b'\x89PNG\r\n\x1a\n')
 (OUT/(name+'.png')).write_bytes(png)
 print('Captured public view',name,flush=True)

adb('shell','am','start','-W','-n',PACKAGE+'/io.bluewallet.bluewallet.MainActivity')
find('CreateAWallet')
tap('CreateAWallet');write('WalletNameInput','Empty demo - do not fund')
back();tap('ActivateBitcoinButton');tap('Create')
# A generated disposable seed is displayed here. Do not print, save or capture it.
find('PleaseBackupScrollView',timeout=120);tap('PleasebackupOk',scroll=True,timeout=120)
find('SettingsButton');tap('SettingsButton');tap('GeneralSettings')
title=find('Allow Screen Capture',scroll=True)
ty=center(title)[1]
switches=[n for n in nodes() if n.get('class')=='android.widget.Switch' and center(n)]
assert switches
switch=min(switches,key=lambda n:abs(center(n)[1]-ty))
assert abs(center(switch)[1]-ty)<160
if switch.get('checked')!='true':
 x,y=center(switch);adb('shell','input','tap',x,y);time.sleep(1)

# Temporary capture permission is enabled only inside this fresh empty CI wallet.
# It automatically resets when the app closes; production defaults are untouched.
back();tap('XbtPriceSettings');write('XbtPriceInput','3.12');back();tap('SaveXbtPrice',scroll=True)
find('XbtPriceSavedQuote',scroll=True)
back();back();tap('Empty demo - do not fund')
snap('01-wallet-overview','ReceiveButton')
tap('ReceiveButton')
try:tap('Yes, I have.',timeout=8)
except RuntimeError:pass
find('CopyTextToClipboard');tap('SetCustomAmountButton');write('BitcoinAmountInput','0.001')
write('CustomAmountDescription','Demo only - do not fund');back();tap('CustomAmountSaveButton',scroll=True)
snap('02-receive-qr','CopyTextToClipboard')
back();back();find('SettingsButton');tap('SettingsButton');tap('XbtPriceSettings')
find('XbtPriceSavedQuote',scroll=True)
snap('03-xbt-price-options','XbtPriceSavedQuote')
back();tap('NetworkSettings');tap('ElectrumSettings')
snap('04-authenticated-fulcrum-settings','HostInput')
receipt={'apkSha256':EXPECTED,'version':'8.0.1','buildNumber':1791019127,'capture':'actual signed APK on Android API 36 emulator','physicalPhoneTested':False,'wallet':'new empty disposable wallet; do not fund displayed address','displayQuote':'manual demo quote 3.12 USDC; not a market price','screenCapture':'temporarily enabled in empty demo through normal app settings; resets on closing','files':sorted(p.name for p in OUT.glob('*.png'))}
assert len(receipt['files'])==4
(OUT/'screenshot-receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
adb('shell','am','force-stop',PACKAGE)
