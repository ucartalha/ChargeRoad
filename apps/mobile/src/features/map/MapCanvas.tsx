import {useEffect,useMemo,useRef,useState} from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import {ActivityIndicator,Linking,Modal,Platform,Pressable,ScrollView,StyleSheet,Text,useWindowDimensions,View} from 'react-native';
import * as Location from 'expo-location';
import MapView,{Marker,Polyline} from 'react-native-maps';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import {NavigationHud} from '../navigation/NavigationOverlay';
import {followCamera,splitRoute} from '../navigation/navigation-view';
import type {Region} from 'react-native-maps';
import type {Coordinate,LocationResult,PlannedChargingStop} from '@chargeroad/shared';
import {stationPin,socketSummary,connectorLabel} from './station-presentation';
import {catalogueRequest} from '../../api/catalogue';
import {colors as c} from '../../theme';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {ChargingStopSummary,RouteLine} from './RouteVisuals';
import type {NavigationProgress,NavigationRoute} from '../navigation/navigation-core';
/** navigation (step 1): set while a trip is actively tracked; switches the map to the full-screen follow mode. */
export type MapState={origin:LocationResult|null;destination:LocationResult|null;geometry:Coordinate[];navigationLocation?:(Coordinate&{speed?:number|null})|null;
  navigation?:{route:NavigationRoute;confirmedStopId:string|null;correctSoc?:(percent:number)=>string|null}|null;
  navigationProgress?:NavigationProgress|null;navigationAttributions?:{text:string;url:string;license:string}[];stops:{id:string;location:Coordinate;label:string;plan?:PlannedChargingStop}[]};
type Pin=NonNullable<ReturnType<typeof stationPin>>;
const initial={latitude:41.02,longitude:29.04,latitudeDelta:.18,longitudeDelta:.18};
export function MapCanvas({state,onOpenNavigation,bottomInset=260}:{state:MapState;onOpenNavigation?:()=>void;bottomInset?:number}){
  const insets=useSafeAreaInsets(),{height}=useWindowDimensions();
  const map=useRef<MapView>(null),[region,setRegion]=useState<Region>(initial),[pins,setPins]=useState<Pin[]>([]),[error,setError]=useState(''),[loading,setLoading]=useState(false),[revision,setRevision]=useState(0);
  const [permission,setPermission]=useState(false),[locating,setLocating]=useState(false),[locationError,setLocationError]=useState(''),[position,setPosition]=useState<Coordinate|null>(null),[ready,setReady]=useState(false);
  const [selected,setSelected]=useState<Pin|null>(null),[selectedStop,setSelectedStop]=useState<PlannedChargingStop|null>(null);
  const [detailLoading,setDetailLoading]=useState(false),[detailError,setDetailError]=useState('');
  const detailRequest=useRef(0);
  function closeDetail(){detailRequest.current++;setSelected(null);setSelectedStop(null);setDetailLoading(false);setDetailError('');}
  const centered=useRef(false),panned=useRef(false),alive=useRef(true),routeVisible=useRef(false),forceCenter=useRef(false);
  routeVisible.current=!!(state.origin||state.destination||state.geometry.length);
  // Navigation step 1: full-screen follow mode while a trip is tracked. Dragging the map stops following until "Ortala".
  const nav=state.navigation??null,progress=state.navigationProgress??null,[following,setFollowing]=useState(true);
  useEffect(()=>{if(nav)setFollowing(true);},[!!nav]);
  const bucket=progress?Math.round(progress.distance/10):-1;
  const split=useMemo(()=>nav&&progress?splitRoute(nav.route,progress.distance):null,[nav?.route,bucket]);
  useEffect(()=>{if(!ready||!nav||!following)return;const center=split?.point??state.navigationLocation;if(!center)return;
    map.current?.animateCamera(followCamera(center,split?.bearing??0,state.navigationLocation?.speed),{duration:900});
  },[ready,nav,following,split,state.navigationLocation]);
  useEffect(()=>{if(ready&&state.navigationLocation&&!panned.current&&!nav)map.current?.animateToRegion({...state.navigationLocation,latitudeDelta:.012,longitudeDelta:.012},500);},[state.navigationLocation,ready]);
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
  async function openStop(stop:MapState['stops'][number]){const request=++detailRequest.current;setSelected(null);setSelectedStop(stop.plan??null);setDetailError('');setDetailLoading(false);
    const known=pins.find(p=>p.id===stop.plan?.stationId);if(known){setSelected(known);return;}
    if(!stop.plan)return;setDetailLoading(true);try{const item=await catalogueRequest<{id:string;payload:{station:unknown;connectorClaims?:unknown[]}}>('/stations/'+stop.plan.stationId);
      if(alive.current&&request===detailRequest.current){const pin=stationPin(item.id,item.payload);setSelected(pin);if(!pin)setDetailError('İstasyon ayrıntısı şu anda gösterilemiyor.');}}
    catch{if(alive.current&&request===detailRequest.current)setDetailError('İstasyon ayrıntısı yüklenemedi. Şarj planını aşağıda görebilirsin.');}
    finally{if(alive.current&&request===detailRequest.current)setDetailLoading(false);}}
  useEffect(()=>{const coords=state.geometry.length?state.geometry:[state.origin?.coordinate,state.destination?.coordinate].filter((v):v is Coordinate=>!!v);
    if(state.navigationLocation||nav)return;
    if(coords.length>1)map.current?.fitToCoordinates(coords,{edgePadding:{top:130,bottom:bottomInset+70,left:45,right:45},animated:true});
    else if(coords[0])map.current?.animateToRegion({...coords[0],latitudeDelta:.07,longitudeDelta:.07},500);
  },[state.origin,state.destination,state.geometry,ready,bottomInset]);
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
      mapPadding={nav?{top:Math.round(height*.38),bottom:bottomInset,left:0,right:0}:{top:95,bottom:bottomInset,left:0,right:0}} showsUserLocation={permission&&!nav} showsMyLocationButton={false}
      onMapReady={()=>setReady(true)} onPanDrag={()=>{panned.current=true;if(nav)setFollowing(false);}} onUserLocationChange={event=>{
        const point=event.nativeEvent.coordinate;if(point)setPosition({latitude:point.latitude,longitude:point.longitude});}}
      showsCompass showsPointsOfInterests={false} showsBuildings={false} toolbarEnabled={false}>
      {!nav&&pins.filter(pin=>!state.stops.some(stop=>stop.plan?.stationId===pin.id)).map(pin=><Marker key={pin.id} coordinate={pin.coordinate} title={pin.name} description={socketSummary(pin)+' · canlı durum bilinmiyor'}
        onPress={()=>{closeDetail();setSelected(pin);}} tracksViewChanges={false}>
        <View style={s.pin}><Ionicons name="flash" size={17} color="white"/></View></Marker>)}
      {state.origin&&!nav&&<Marker coordinate={state.origin.coordinate} title="Başlangıç" pinColor={c.green}/>}
      {state.destination&&<Marker coordinate={state.destination.coordinate} title="Varış" pinColor={c.orange}/>}
      {state.geometry.length>1&&!split&&<RouteLine coordinates={state.geometry} loop={!nav}/>}
      {split&&<>
        {split.traveled.length>1&&<Polyline coordinates={split.traveled} strokeColor="#9AA79F" strokeWidth={7} lineCap="round" lineJoin="round"/>}
        <Polyline coordinates={split.remaining} strokeColor="#FFFFFF" strokeWidth={12} lineCap="round" lineJoin="round"/>
        <Polyline coordinates={split.remaining} strokeColor="#1F8F5F" strokeWidth={8} lineCap="round" lineJoin="round"/>
        <Marker coordinate={split.point} flat rotation={split.bearing} anchor={{x:.5,y:.5}} zIndex={30} tracksViewChanges={false}>
          <View style={s.vehicle}><MaterialCommunityIcons name="navigation" size={26} color="white"/></View></Marker>
      </>}
      {state.stops.map((stop,index)=><Marker key={stop.id+':'+index} coordinate={stop.location} title={stop.label} anchor={{x:.5,y:1}} zIndex={20} tracksViewChanges={false} onPress={()=>void openStop(stop)}>
        <View collapsable={false} style={s.stopMarker}><View style={s.stopBadge}><View style={s.stopBolt}><Ionicons name="flash" size={19} color={c.ink}/></View><Text style={s.stopNumber}>{index+1}</Text></View><View style={s.stopTip}/></View>
      </Marker>)}
    </MapView>
    {nav&&<NavigationHud route={nav.route} progress={progress} confirmedStopId={nav.confirmedStopId} onCorrectSoc={nav.correctSoc} speed={state.navigationLocation?.speed} top={insets.top+10} bottom={bottomInset+14}/>}
    {nav&&!following&&<Pressable accessibilityRole="button" accessibilityLabel="Haritayı araca ortala" onPress={()=>setFollowing(true)} style={[s.recenter,{bottom:bottomInset+24}]}>
      <MaterialCommunityIcons name="navigation" size={20} color={c.green}/><Text style={s.recenterText}>Ortala</Text></Pressable>}
    {nav&&!!state.navigationAttributions?.length&&<Text style={[s.attribution,{bottom:bottomInset+4}]} onPress={()=>void Linking.openURL(state.navigationAttributions![0].url)}>{state.navigationAttributions[0].text}</Text>}
    {!nav&&state.navigationProgress&&<View style={{position:'absolute',top:insets.top+116,left:18,right:18,padding:14,borderRadius:18,backgroundColor:'white',gap:5}}>
      <Pressable accessibilityRole="button" accessibilityLabel="Navigasyon ayrıntılarını aç" onPress={onOpenNavigation}>
        <Text style={{color:c.ink,fontSize:16,fontWeight:'700'}}>{Math.round(state.navigationProgress.instructionDistance)} m · {state.navigationProgress.instruction}</Text>
        <Text style={s.caption}>Tahmini şarj %{state.navigationProgress.soc.toFixed(1)} · {(state.navigationProgress.remainingMeters/1000).toFixed(1)} km kaldı</Text>
      </Pressable>
      {state.navigationAttributions?.map(a=><Pressable key={a.url} accessibilityRole="link" onPress={()=>void Linking.openURL(a.url)}><Text style={s.caption}>{a.text}</Text></Pressable>)}
    </View>}
    {!nav&&<><View pointerEvents="box-none" style={[s.status,{top:insets.top+68}]}>
      {loading?<View style={s.chip}><ActivityIndicator size="small" color={c.green}/><Text style={s.caption}>İstasyonlar</Text></View>:
        error?<Pressable accessibilityRole="button" onPress={()=>setRevision(r=>r+1)} style={s.chip}><Text style={s.caption}>{error} · Tekrar dene</Text></Pressable>:
        <View style={s.chip}><View style={s.dot}/><Text style={s.caption}>{region.latitudeDelta>1?'İstasyonları görmek için yakınlaştır':`${pins.length} istasyon · canlı durum bilinmiyor`}</Text></View>}
    </View>
    <Pressable testID="map-my-location" accessibilityRole="button" accessibilityLabel="Haritayı mevcut konumuma getir" onPress={()=>{
      panned.current=false;
      if(position){map.current?.animateToRegion({...position,latitudeDelta:.045,longitudeDelta:.045},500);}else void locate(true);
    }} style={[s.locate,{bottom:insets.bottom+280}]}>{locating?<ActivityIndicator color={c.green}/>:<Text style={s.locateIcon}>◎</Text>}</Pressable>
    {!!locationError&&<Pressable onPress={()=>void locate(true)} style={[s.locationNotice,{bottom:insets.bottom+335}]}><Text style={s.caption}>{locationError}</Text></Pressable>}</>}
    <Modal visible={!!selected||!!selectedStop} transparent animationType="slide" onRequestClose={closeDetail}>
      <View style={s.modal}><Pressable style={s.backdrop} accessibilityLabel="İstasyon ayrıntısını kapat" onPress={closeDetail}/>
        <View style={[s.detail,{paddingBottom:insets.bottom+20}]}><View style={s.handle}/><ScrollView>
          <View style={s.detailTitle}><View style={s.stationIcon}><Ionicons name="flash" size={24} color={c.green}/></View><View style={{flex:1,gap:4}}><Text style={s.caption}>{selectedStop?'ROTANDAKİ ŞARJ NOKTASI':'ŞARJ NOKTASI'}</Text><Text style={s.heading}>{selected?.name??'Planlanan şarj durağı'}</Text></View><Pressable style={s.close} onPress={closeDetail} accessibilityRole="button" accessibilityLabel="Kapat"><Ionicons name="close" size={22} color={c.green}/></Pressable></View>
          <View style={s.availability}><Ionicons name="information-circle-outline" size={16} color={c.muted}/><Text style={s.availabilityText}>Canlı müsaitlik doğrulanmadı</Text></View>
          {selectedStop&&<ChargingStopSummary stop={selectedStop}/>}
          {detailLoading&&<View style={s.loadingDetail}><ActivityIndicator color={c.green}/><Text style={s.body}>Soket bilgileri yükleniyor…</Text></View>}
          {!!detailError&&<Text accessibilityRole="alert" style={s.body}>{detailError}</Text>}
          <Text style={s.section}>SOKETLER VE GÜÇ</Text>
          {selected?.station.evses.flatMap(e=>e.connectors.map(p=><View key={e.id+':'+p.id} style={s.socket}><View style={s.socketHeading}><View style={s.connectorIcon}><Ionicons name="flash-outline" size={20} color={c.green}/></View><Text style={[s.body,s.connectorText]}>{connectorLabel(p)}</Text></View></View>))}
          {selected?.claims.map(claim=><View key={claim.sourceConnectorId} style={s.socket}><View style={s.socketHeading}><View style={s.connectorIcon}><Ionicons name="flash-outline" size={20} color={c.green}/></View><Text style={[s.body,s.connectorText]}>{connectorLabel(claim)}</Text></View>
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
const s=StyleSheet.create({vehicle:{width:44,height:44,borderRadius:22,backgroundColor:'#1F8F5F',borderWidth:3,borderColor:'white',alignItems:'center',justifyContent:'center',elevation:6},
  recenter:{position:'absolute',right:14,flexDirection:'row',alignItems:'center',gap:8,paddingHorizontal:18,paddingVertical:11,borderRadius:24,backgroundColor:'white',elevation:6},
  recenterText:{color:c.green,fontWeight:'800',fontSize:15},attribution:{position:'absolute',left:12,fontSize:10,color:c.muted,backgroundColor:'rgba(255,255,255,.75)',paddingHorizontal:6,borderRadius:6},
  web:{position:'absolute',top:0,left:0,right:0,bottom:0,alignItems:'center',justifyContent:'center',backgroundColor:'#DFE8DF'},pin:{width:31,height:31,borderRadius:12,backgroundColor:c.green,borderWidth:2,borderColor:'white',alignItems:'center',justifyContent:'center'},
  stopMarker:{width:72,height:59,alignItems:'center'},stopBadge:{height:44,paddingHorizontal:8,flexDirection:'row',gap:7,alignItems:'center',backgroundColor:c.ink,borderRadius:17,borderWidth:2,borderColor:'white'},stopBolt:{width:28,height:28,borderRadius:10,backgroundColor:c.lime,alignItems:'center',justifyContent:'center'},stopNumber:{color:'white',fontSize:16,fontWeight:'800'},stopTip:{width:12,height:12,backgroundColor:c.ink,transform:[{rotate:'45deg'}],marginTop:-7,zIndex:-1},
  stationIcon:{width:46,height:46,borderRadius:16,backgroundColor:c.softGreen,alignItems:'center',justifyContent:'center'},close:{padding:10,borderRadius:22,backgroundColor:c.softGreen},availability:{flexDirection:'row',alignItems:'center',gap:6,marginTop:14},availabilityText:{fontSize:12,color:c.muted},loadingDetail:{flexDirection:'row',alignItems:'center',gap:10,marginTop:16},socketHeading:{flexDirection:'row',alignItems:'center',gap:10},connectorIcon:{width:36,height:36,borderRadius:12,backgroundColor:'#DEEBDD',alignItems:'center',justifyContent:'center'},connectorText:{flex:1,fontWeight:'700'},
  status:{position:'absolute',top:110,left:18,right:18,alignItems:'flex-start'},chip:{backgroundColor:'white',borderRadius:22,paddingHorizontal:12,paddingVertical:8,flexDirection:'row',alignItems:'center',gap:7,elevation:2},caption:{color:c.green,fontSize:10,fontWeight:'600'},dot:{height:6,width:6,borderRadius:3,backgroundColor:c.green},
  locate:{position:'absolute',right:18,width:48,height:48,borderRadius:24,backgroundColor:'white',alignItems:'center',justifyContent:'center',elevation:4},locateIcon:{fontSize:28,color:c.green},locationNotice:{position:'absolute',right:18,padding:10,borderRadius:15,backgroundColor:'white'},
  modal:{flex:1,justifyContent:'flex-end'},backdrop:{position:'absolute',top:0,left:0,right:0,bottom:0,backgroundColor:'#10241C88'},detail:{maxHeight:'78%',backgroundColor:c.background,borderTopLeftRadius:30,borderTopRightRadius:30,padding:22,gap:18},handle:{alignSelf:'center',width:36,height:4,borderRadius:3,backgroundColor:c.line},
  detailTitle:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:12},heading:{fontSize:20,fontWeight:'800',color:c.ink,flexShrink:1},body:{fontSize:13,color:c.ink,lineHeight:21},section:{fontSize:11,fontWeight:'800',letterSpacing:.7,color:c.green,marginTop:22,marginBottom:12},socket:{padding:14,borderWidth:1,borderColor:c.line,borderRadius:17,backgroundColor:'white',marginBottom:8,gap:7}});
