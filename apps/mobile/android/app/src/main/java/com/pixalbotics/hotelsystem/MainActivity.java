package com.pixalbotics.hotelsystem;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(HotelDiscoveryPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
