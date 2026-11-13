import {useEffect,useMemo,useRef} from 'react';
import {Animated,PanResponder,Pressable,StyleSheet,Text,useWindowDimensions,View} from 'react-native';
import type {ReactNode} from 'react';
import {colors as c} from '../../theme';
export function RouteSheet({children,expanded,onExpand}:{children:ReactNode;expanded:boolean;onExpand:(expanded:boolean)=>void}){
  const {height}=useWindowDimensions(),full=Math.max(400,height-100),peek=215,travel=full-peek;
  const offset=useRef(new Animated.Value(travel)).current,start=useRef(travel),current=useRef(travel),callback=useRef(onExpand);callback.current=onExpand;
  useEffect(()=>{const subscription=offset.addListener(({value})=>{current.current=value;});return()=>offset.removeListener(subscription);},[offset]);
  useEffect(()=>{Animated.spring(offset,{toValue:expanded?0:travel,useNativeDriver:true,damping:28,stiffness:240,mass:1}).start();},[expanded,travel,offset]);
  const responder=useMemo(()=>PanResponder.create({onStartShouldSetPanResponder:()=>true,onMoveShouldSetPanResponder:(_,g)=>Math.abs(g.dy)>4,
    onPanResponderGrant:()=>{offset.stopAnimation();start.current=current.current;},onPanResponderMove:(_,g)=>offset.setValue(Math.max(0,Math.min(travel,start.current+g.dy))),
    onPanResponderRelease:(_,g)=>{const open=g.vy<-.3||g.vy<=.3&&current.current<travel*.6;callback.current(open);
      Animated.spring(offset,{toValue:open?0:travel,useNativeDriver:true,damping:28,stiffness:240,mass:1}).start();},
    onPanResponderTerminate:()=>Animated.spring(offset,{toValue:expanded?0:travel,useNativeDriver:true}).start()}),[travel,offset,expanded]);
  return <Animated.View testID="route-bottom-sheet" style={[s.sheet,{height:full,transform:[{translateY:offset}]}]}>
    <View {...responder.panHandlers} style={s.handleArea}><View style={s.handle}/></View>
    <Pressable accessibilityRole="button" accessibilityLabel={expanded?'Rota ayarlarını küçült':'Rota ayarlarını aç'} onPress={()=>onExpand(!expanded)} style={s.titleRow}>
      <View><Text style={s.title}>{expanded?'Yolculuğun sana göre.':'Nereye gidiyoruz?'}</Text><Text style={s.subtitle}>{expanded?'Rotanı seç, gerisini birlikte planlayalım.':'Rotan, şarjın ve molaların bir arada.'}</Text></View>
      <Text style={s.arrow}>{expanded?'⌄':'↗'}</Text>
    </Pressable>
    {children}
  </Animated.View>;
}
const s=StyleSheet.create({sheet:{position:'absolute',left:0,right:0,bottom:0,backgroundColor:c.background,borderTopLeftRadius:30,borderTopRightRadius:30,elevation:12,shadowColor:'#12382A',shadowOpacity:.15,shadowRadius:20,shadowOffset:{width:0,height:-4}},
  handleArea:{height:27,alignItems:'center',justifyContent:'center'},handle:{width:38,height:4,borderRadius:3,backgroundColor:'#C6D0C9'},titleRow:{paddingHorizontal:23,paddingBottom:18,flexDirection:'row',alignItems:'center',justifyContent:'space-between'},
  title:{fontSize:23,fontWeight:'800',color:c.ink,letterSpacing:-.7},subtitle:{fontSize:12,color:c.muted,marginTop:5},arrow:{fontSize:25,color:c.green}});
