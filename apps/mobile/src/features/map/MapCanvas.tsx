import {useEffect,useRef,useState} from 'react';
import {ActivityIndicator,Linking,Modal,Platform,Pressable,ScrollView,StyleSheet,Text,View} from 'react-native';
import * as Location from 'expo-location';
import MapView,{Marker,Polyline} from 'react-native-maps';
import type {Region} from 'react-native-maps';
import type {Coordinate,LocationResult,PlannedChargingStop} from '@chargeroad/shared';
import {stationPin,socketSummary,connectorLabel} from './station-presentation';
import {catalogueRequest} from '../../api/catalogue';
import {colors as c} from '../../theme';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import type {NavigationProgress} from '../navigation/navigation-core';
export type MapState={origin:LocationResult|null;destination:LocationResult|null;geometry:Coordinate[];navigationLocation?:Coordinate|null;
  navigationProgress?:NavigationProgress|null;navigationAttributions?:{text:string;url:string;license:string}[];stops:{id:string;location:Coordinate;label:string;plan?:PlannedChargingStop}[]};
type Pin=NonNullable<ReturnType<typeof stationPin>>;
const initial={latitude:41.02,longitude:29.04,latitudeDelta:.18,longitudeDelta:.18};
export function MapCanvas({state,onOpenNavigation}:{state:MapState;onOpenNavigation?:()=>void}){
  const insets=useSafeAreaInsets();
  const map=useRef<MapView>(null),[region,setRegion]=useState<Region>(initial),[pins,setPins]=useState<Pin[]>([]),[error,setError]=useState(''),[loading,setLoading]=useState(false),[revision,setRevision]=useState(0);
  const [permission,setPermission]=useState(false),[locating,setLocating]=useState(false),[locationError,setLocationError]=useState(''),[position,setPosition]=useState<Coordinate|null>(null),[ready,setReady]=useState(false);
  const [selected,setSelected]=useState<Pin|null>(null),[selectedStop,setSelectedStop]=useState<PlannedChargingStop|null>(null);
  const centered=useRef(false),panned=useRef(false),alive=useRef(true),routeVisible=useRef(false),forceCenter=useRef(false);
  routeVisible.current=!!(state.origin||state.destination||state.geometry.length);
  useEffect(()=>{if(ready&&state.navigationLocation&&!panned.current)map.current?.animateToRegion({...state.navigationLocation,latitudeDelta:.012,longitudeDelta:.012},500);},[state.navigationLocation,ready]);
  async function locate(manual=false){if(Platform.OS==='web')return;setLocating(true);setLocationError('');let timer:ReturnType<typeof setTimeout>|undefined;
    try{const granted=await Location.requestForegroundPermissionsAsync();if(!alive.current)return;
      setPermission(granted.status==='granted');if(granted.status!=='granted'){setLocationError('Konum izni kapalı');return;}
      if(manual){panned.current=false;centered.current=false;forceCenter.current=true;}
      const cached=await Location.getLastKnownPositionAsync({maxAge:60000,requiredAccuracy:500});
      if(alive.current&&cached)setPosition({latitude:cached.coords.latitude,longitude:cached.coords.longitude});
      const current=await Promise.race([Location.getCurrentPositionAsync({accuracy:Location.Accuracy.Balanced}),new Promise<never>((_,reject)=>{
        timer=setTimeout(()=>reject(new Error('Konum bekleniyor; haritayı kullanabilirsin')),12000);})]);
      if(alive.current)setPosition({latitude:current.coords.latitude,longitude:current.coords.longitude});
    }catch{if(alive.current)setLocationError('Konum alınamadı · tekrar dene');}finally{if(timer)clearTimeout(timer);if(alive.current)setLocating(false);}}
  useEffect(()=>{alive.current=true;void locate();return()=>{alive.current=false;};},[]);
  useEffect(()=>{if(ready&&position&&!centered.current&&!panned.current&&(!routeVisible.current||forceCenter.current)){
    map.current?.animateToRegion({...position,latitudeDelta:.045,longitudeDelta:.045},500);centered.current=true;forceCenter.current=false;}
  },[ready,position]);
  async function openStop(stop:MapState['stops'][number]){setSelectedStop(stop.plan??null);
    const known=pins.find(p=>p.id===stop.plan?.stationId);if(known){setSelected(known);return;}
    if(!stop.plan)return;try{const item=await catalogueRequest<{id:string;payload:{station:unknown;connectorClaims?:unknown[]}}>('/stations/'+stop.plan.stationId);
      if(alive.current)setSelected(stationPin(item.id,item.payload));}catch{if(alive.current)setError('Durak ayrıntısı alınamadı');}}
  useEffect(()=>{const coords=state.geometry.length?state.geometry:[state.origin?.coordinate,state.destination?.coordinate].filter((v):v is Coordinate=>!!v);
    if(state.navigationLocation)return;
    if(coords.length>1)map.current?.fitToCoordinates(coords,{edgePadding:{top:130,bottom:330,left:45,right:45},animated:true});
    else if(coords[0])map.current?.animateToRegion({...coords[0],latitudeDelta:.07,longitudeDelta:.07},500);
  },[state.origin,state.destination,state.geometry,ready]);
  useEffect(()=>{const controller=new AbortController();let live=true;setError('');setLoading(false);
    if(region.latitudeDelta>1||region.longitudeDelta>1){setPins([]);return()=>controller.abort();}
    const timer=setTimeout(()=>{setLoading(true);const q=new URLSearchParams({west:String(region.longitude-region.longitudeDelta/2),east:String(region.longitude+region.longitudeDelta/2),
      south:String(region.latitude-region.latitudeDelta/2),north:String(region.latitude+region.latitudeDelta/2),limit:'50'});
      void catalogueRequest<{items:{id:string;payload:{station:unknown;connectorClaims?:unknown[]}}[]}>('/stations?'+q,controller.signal).then(response=>{
        if(!live)return;setPins(response.items.flatMap(item=>{const pin=stationPin(item.id,item.payload);return pin?[pin]:[];}));
      }).catch(()=>{if(live){setPins([]);setError('İstasyonlar yüklenemedi');}}).finally(()=>{if(live)setLoading(false);});},900);
    return()=>{live=false;clearTimeout(timer);controller.abort();};
  },[region,revision]);
  if(Platform.OS==='web')return <View style={s.web}><Text>Harita görünümü için Expo Go üzerinden aç.</Text></View>;
  return <View style={StyleSheet.absoluteFill}>
    <MapView ref={map} testID="planning-map" style={StyleSheet.absoluteFill} initialRegion={initial} onRegionChangeComplete={setRegion}
      mapPadding={{top:95,bottom:260,left:0,right:0}} showsUserLocation={permission} showsMyLocationButton={false}
      onMapReady={()=>setReady(true)} onPanDrag={()=>{panned.current=true;}} onUserLocationChange={event=>{
        const point=event.nativeEvent.coordinate;if(point)setPosition({latitude:point.latitude,longitude:point.longitude});}}
      showsCompass showsPointsOfInterests={false} showsBuildings={false} toolbarEnabled={false}>
      {pins.map(pin=><Marker key={pin.id} coordinate={pin.coordinate} title={pin.name} description={socketSummary(pin)+' · canlı durum bilinmiyor'}
        onPress={()=>{setSelectedStop(null);setSelected(pin);}} tracksViewChanges={false}>
        <View style={s.pin}><Text style={s.bolt}>ϟ</Text></View></Marker>)}
      {state.origin&&<Marker coordinate={state.origin.coordinate} title="Başlangıç" pinColor={c.green}/>}
      {state.destination&&<Marker coordinate={state.destination.coordinate} title="Varış" pinColor={c.orange}/>}
      {state.geometry.length>1&&<Polyline coordinates={state.geometry} strokeColor={c.green} strokeWidth={6}/>}
      {state.stops.map(stop=><Marker key={stop.id} coordinate={stop.location} title={stop.label} pinColor={c.green} onPress={()=>void openStop(stop)}/>)}
    </MapView>
    {state.navigationProgress&&<View style={{position:'absolute',top:insets.top+116,left:18,right:18,padding:14,borderRadius:18,backgroundColor:'white',gap:5}}>
      <Pressable accessibilityRole="button" accessibilityLabel="Navigasyon ayrıntılarını aç" onPress={onOpenNavigation}>
        <Text style={{color:c.ink,fontSize:16,fontWeight:'700'}}>{Math.round(state.navigationProgress.instructionDistance)} m · {state.navigationProgress.instruction}</Text>
        <Text style={s.caption}>Tahmini şarj %{state.navigationProgress.soc.toFixed(1)} · {(state.navigationProgress.remainingMeters/1000).toFixed(1)} km kaldı</Text>
      </Pressable>
      {state.navigationAttributions?.map(a=><Pressable key={a.url} accessibilityRole="link" onPress={()=>void Linking.openURL(a.url)}><Text style={s.caption}>{a.text}</Text></Pressable>)}
    </View>}
    <View pointerEvents="box-none" style={[s.status,{top:insets.top+68}]}>
      {loading?<View style={s.chip}><ActivityIndicator size="small" color={c.green}/><Text style={s.caption}>İstasyonlar</Text></View>:
        error?<Pressable accessibilityRole="button" onPress={()=>setRevision(r=>r+1)} style={s.chip}><Text style={s.caption}>{error} · Tekrar dene</Text></Pressable>:
        <View style={s.chip}><View style={s.dot}/><Text style={s.caption}>{region.latitudeDelta>1?'İstasyonları görmek için yakınlaştır':`${pins.length} istasyon · canlı durum bilinmiyor`}</Text></View>}
    </View>
    <Pressable testID="map-my-location" accessibilityRole="button" accessibilityLabel="Haritayı mevcut konumuma getir" onPress={()=>{
      panned.current=false;
      if(position){map.current?.animateToRegion({...position,latitudeDelta:.045,longitudeDelta:.045},500);}else void locate(true);
    }} style={[s.locate,{bottom:insets.bottom+280}]}>{locating?<ActivityIndicator color={c.green}/>:<Text style={s.locateIcon}>◎</Text>}</Pressable>
    {!!locationError&&<Pressable onPress={()=>void locate(true)} style={[s.locationNotice,{bottom:insets.bottom+335}]}><Text style={s.caption}>{locationError}</Text></Pressable>}
    <Modal visible={!!selected} transparent animationType="slide" onRequestClose={()=>setSelected(null)}>
      <View style={s.modal}><Pressable style={s.backdrop} accessibilityLabel="İstasyon ayrıntısını kapat" onPress={()=>setSelected(null)}/>
        <View style={[s.detail,{paddingBottom:insets.bottom+20}]}><View style={s.handle}/><ScrollView>
          <View style={s.detailTitle}><Text style={s.heading}>{selected?.name}</Text><Pressable onPress={()=>setSelected(null)} accessibilityLabel="Kapat"><Text style={s.locateIcon}>×</Text></Pressable></View>
          {selectedStop&&<View style={s.stopInfo}><Text style={s.heading}>%{Math.round(selectedStop.arrivalChargePercent)} → %{Math.round(selectedStop.targetChargePercent)}</Text>
            <Text style={s.body}>Şarj: {Math.ceil(selectedStop.chargingDurationSeconds/60)} dk · Bağlantı: {Math.ceil(selectedStop.connectionDurationSeconds/60)} dk</Text>
            <Text style={s.body}>Bekleme süresi bilinmiyor; kesin varış saati verilemiyor.</Text></View>}
          <Text style={s.section}>SOKETLER VE GÜÇ</Text>
          {selected?.station.evses.flatMap(e=>e.connectors.map(p=><View key={e.id+':'+p.id} style={s.socket}><Text style={s.body}>{connectorLabel(p)}</Text></View>))}
          {selected?.claims.map(claim=><View key={claim.sourceConnectorId} style={s.socket}><Text style={s.body}>{connectorLabel(claim)}</Text>
            {(claim.maxCurrentA||claim.nominalVoltageV)&&<Text style={s.caption}>{claim.maxCurrentA?`${claim.maxCurrentA} A `:''}{claim.nominalVoltageV?`${claim.nominalVoltageV} V (kaynak beyanı)`:''}</Text>}
            <Text style={s.caption}>{claim.granularity==='equipment_summary'?'Ekipman özeti; bağımsız EVSE gruplaması bilinmiyor':'Kaynak soket kaydı'}</Text></View>)}
          {!!selected&&!selected.claims.length&&!selected.station.evses.length&&<Text style={s.body}>Kaynakta soket ayrıntısı bulunmuyor.</Text>}
          <Text style={s.body}>Canlı müsaitlik doğrulanmadı. Katalog gücü, o anda alınabilecek gücün garantisi değildir.</Text>
          {selected&&<Pressable accessibilityRole="link" onPress={()=>{if(selected.station.source.url)void Linking.openURL(selected.station.source.url);}}>
            <Text style={s.section}>Kaynak: {selected.station.source.sourceId}</Text><Text style={s.caption}>Alınma: {new Date(selected.station.source.retrievedAt).toLocaleString('tr-TR')}</Text></Pressable>}
        </ScrollView></View></View>
    </Modal>
  </View>;
}
const s=StyleSheet.create({web:{position:'absolute',top:0,left:0,right:0,bottom:0,alignItems:'center',justifyContent:'center',backgroundColor:'#DFE8DF'},pin:{width:29,height:29,borderRadius:10,backgroundColor:c.green,borderWidth:2,borderColor:'white',alignItems:'center',justifyContent:'center'},bolt:{color:'white',fontSize:20,fontWeight:'900'},
  status:{position:'absolute',top:110,left:18,right:18,alignItems:'flex-start'},chip:{backgroundColor:'white',borderRadius:22,paddingHorizontal:12,paddingVertical:8,flexDirection:'row',alignItems:'center',gap:7,elevation:2},caption:{color:c.green,fontSize:10,fontWeight:'600'},dot:{height:6,width:6,borderRadius:3,backgroundColor:c.green},
  locate:{position:'absolute',right:18,width:48,height:48,borderRadius:24,backgroundColor:'white',alignItems:'center',justifyContent:'center',elevation:4},locateIcon:{fontSize:28,color:c.green},locationNotice:{position:'absolute',right:18,padding:10,borderRadius:15,backgroundColor:'white'},
  modal:{flex:1,justifyContent:'flex-end'},backdrop:{position:'absolute',top:0,left:0,right:0,bottom:0,backgroundColor:'#0006'},detail:{maxHeight:'65%',backgroundColor:'white',borderTopLeftRadius:26,borderTopRightRadius:26,padding:22,gap:12},handle:{alignSelf:'center',width:36,height:4,borderRadius:3,backgroundColor:c.line},
  detailTitle:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:15},heading:{fontSize:18,fontWeight:'700',color:c.ink,flexShrink:1},body:{fontSize:13,color:c.ink,lineHeight:21},section:{fontSize:11,fontWeight:'700',color:c.green,marginTop:18,marginBottom:8},socket:{paddingVertical:10,borderBottomWidth:1,borderBottomColor:c.line,gap:5},stopInfo:{padding:14,marginTop:12,borderRadius:16,backgroundColor:c.softGreen}});
